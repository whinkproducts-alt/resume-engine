import { beforeEach, describe, expect, it } from 'vitest';
import { ProfilesService } from '../src/profiles/profiles.service';
import { toMonthDate } from '../src/profiles/dto/roster.dto';
import type { AuthUser } from '../src/auth/auth.types';
import { FakePrisma } from './fake-prisma';

const alice: AuthUser = { id: 'alice', role: 'PRO', isAdmin: false };
const bob: AuthUser = { id: 'bob', role: 'PRO', isAdmin: false };

let db: FakePrisma;
let svc: ProfilesService;
beforeEach(() => {
  db = new FakePrisma();
  svc = new ProfilesService(db.asService());
  db.profile.rows.push({ id: 'p1', userId: 'alice' });
});

const role = (company: string, start: string, end?: string | null) => ({
  companyName: company, title: 'Manager', baseTitle: 'Manager', startDate: start, endDate: end ?? null,
  location: 'Lagos', baseFlagship: 'Led it', baseBullets: ['Did a thing'],
});

describe('roster endpoints', () => {
  it('replaceRoles keeps array order as orderIndex and stores UTC month dates', async () => {
    await svc.replaceRoles(alice, 'p1', { roles: [role('Acme', '2020-01'), role('Globex', '2016-03', '2019-12')] });
    const rows = db.roleEntry.rows;
    expect(rows.map((r) => [r.companyName, r.orderIndex])).toEqual([['Acme', 0], ['Globex', 1]]);
    expect(rows[0]!.startDate.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect(rows[1]!.endDate.toISOString().slice(0, 7)).toBe('2019-12');
    expect(rows[0]!.endDate).toBeNull();
  });

  it('replaces, not appends', async () => {
    await svc.replaceRoles(alice, 'p1', { roles: [role('Acme', '2020-01'), role('Globex', '2016-03')] });
    await svc.replaceRoles(alice, 'p1', { roles: [role('Initech', '2021-05')] });
    expect(db.roleEntry.rows.map((r) => r.companyName)).toEqual(['Initech']);
  });

  it('rejects an end date before the start date and leaves the roster alone', async () => {
    await svc.replaceRoles(alice, 'p1', { roles: [role('Acme', '2020-01')] });
    await expect(svc.replaceRoles(alice, 'p1', { roles: [role('Bad', '2020-06', '2020-01')] }))
      .rejects.toMatchObject({ code: 'INVALID_DATES', status: 422 });
    expect(db.roleEntry.rows.map((r) => r.companyName)).toEqual(['Acme']);
  });

  it("another user's profile is a 404 for every roster call", async () => {
    for (const call of [
      () => svc.findOne(bob, 'p1'),
      () => svc.replaceRoles(bob, 'p1', { roles: [] }),
      () => svc.replaceEducation(bob, 'p1', { education: [] }),
      () => svc.replaceCerts(bob, 'p1', { certs: [] }),
      () => svc.activateBase(bob, 'p1', 'b1'),
    ]) await expect(call()).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND', status: 404 });
  });

  it('education and certifications are replaced', async () => {
    await svc.replaceEducation(alice, 'p1', { education: [{ institution: 'UNILAG', degree: 'BSc', startYear: 2008, endYear: 2012 }] });
    await svc.replaceCerts(alice, 'p1', { certs: [{ name: 'PMP', issuer: 'PMI', year: 2018 }, { name: 'CSM' }] });
    expect(db.education.rows).toHaveLength(1);
    expect(db.certification.rows.map((c) => [c.name, c.issuer, c.year])).toEqual([['PMP', 'PMI', 2018], ['CSM', null, null]]);
  });

  it('activateBase flips the active flag and the profile pointer', async () => {
    db.baseResume.rows.push({ id: 'b1', profileId: 'p1', isActive: true }, { id: 'b2', profileId: 'p1', isActive: false });
    await svc.activateBase(alice, 'p1', 'b2');
    expect(db.baseResume.rows.map((b) => [b.id, b.isActive])).toEqual([['b1', false], ['b2', true]]);
    expect(db.profile.rows[0]!.activeBaseId).toBe('b2');
    await expect(svc.activateBase(alice, 'p1', 'missing')).rejects.toMatchObject({ code: 'BASE_RESUME_NOT_FOUND' });
  });
});

describe('toMonthDate', () => {
  it('parses months and days in UTC', () => {
    expect(toMonthDate('2020-01').toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect(toMonthDate('2020-02-15').toISOString()).toBe('2020-02-15T00:00:00.000Z');
  });
});
