import { beforeEach, describe, expect, it } from 'vitest';
import { AdminReadService } from '../src/admin/admin-read.service';
import { AuditService } from '../src/admin/audit.service';
import { SettingsService } from '../src/settings/settings.service';
import { BrandingService } from '../src/branding/branding.service';
import type { QueueService } from '../src/runs/queue.service';
import { currentPeriod } from '../src/runs/quota.service';
import { FakePrisma } from './fake-prisma';

let db: FakePrisma;
let enqueued: unknown[];
let admin: AdminReadService;

beforeEach(() => {
  db = new FakePrisma();
  enqueued = [];
  const queue = { enqueue: async (d: unknown) => { enqueued.push(d); } } as unknown as QueueService;
  admin = new AdminReadService(db.asService(), queue, new AuditService(db.asService()));
  db.user.rows.push(
    { id: 'a1', email: 'admin@example.com', role: 'ADMIN', isAdmin: true, firstName: 'A', lastName: 'D', createdAt: new Date(3), totpEnabledAt: new Date() },
    { id: 'u1', email: 'pro@example.com', role: 'PRO', isAdmin: false, firstName: null, lastName: null, createdAt: new Date(2), totpEnabledAt: null },
    { id: 'u2', email: 'free@example.com', role: 'USER', isAdmin: false, firstName: null, lastName: null, createdAt: new Date(1), totpEnabledAt: null },
  );
  db.usageCounter.rows.push({ userId: 'u1', period: currentPeriod(), runsUsed: 4 });
});

describe('admin users', () => {
  it('lists users with monthly usage and the PRO limit, newest first, with a cursor', async () => {
    const first = await admin.users({ limit: 2 });
    expect(first.items.map((u) => u.email)).toEqual(['admin@example.com', 'pro@example.com']);
    expect(first.items[1]).toMatchObject({ role: 'PRO', runsThisMonth: 4, runsLimit: 10, totpEnabled: false });
    expect(first.items[0]).toMatchObject({ totpEnabled: true, runsLimit: null, name: 'A D' });
    expect(JSON.stringify(first)).not.toContain('passwordHash');

    const second = await admin.users({ limit: 2, cursor: first.nextCursor as string });
    expect(second.items.map((u) => u.email)).toEqual(['free@example.com']);
    expect(second.nextCursor).toBeNull();
  });
});

describe('admin runs, reproduce and audit', () => {
  beforeEach(() => {
    db.jobDescription.rows.push({ id: 'j1', company: 'Stripe', roleTitle: 'PM' });
    db.baseResume.rows.push({ id: 'b1', version: 3 });
    db.run.rows.push({
      id: 'r1', userId: 'u1', profileId: 'p1', baseResumeId: 'b1', ruleSetId: 'ruleset-1', jdId: 'j1',
      planTier: 'PRO', status: 'COMPLETE', stage: 'complete', progress: 1, createdAt: new Date(),
      settingsSnap: { toggles: { strictFactsMode: false } }, contactLocationOverride: 'London',
    });
    db.runLog.rows.push(
      { runId: 'r1', step: 'analyze', modelId: 'm-analyze', createdAt: new Date(1) },
      { runId: 'r1', step: 'rewrite.headline', modelId: 'm-write', createdAt: new Date(2) },
      { runId: 'r1', step: 'rewrite.summary', modelId: 'm-write', createdAt: new Date(3) },
    );
    db.validationFlag.rows.push({ id: 'f1', runId: 'r1', code: 'R10:DUPLICATE_VERB', severity: 'warn', field: null, message: 'm' });
  });

  it('lists all runs with the owner, and validates the status filter', async () => {
    const out = await admin.runs({});
    expect(out.items[0]).toMatchObject({ id: 'r1', userEmail: 'pro@example.com', company: 'Stripe', planTier: 'PRO' });
    await expect(admin.runs({ status: 'NOPE' })).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    expect((await admin.runs({ status: 'FAILED' })).items).toEqual([]);
  });

  it('run detail includes logs, presented flags and the pinned versions', async () => {
    const d = await admin.runDetail('r1');
    expect(d.logs).toHaveLength(3);
    expect(d.flags[0]).toMatchObject({ ruleId: 'R10', code: 'DUPLICATE_VERB', blocking: false });
    expect(d.versions).toEqual({ ruleSet: 'v3.1', promptVersion: 'v1', baseResume: 3, models: ['m-analyze', 'm-write'] });
    await expect(admin.runDetail('missing')).rejects.toMatchObject({ status: 404 });
  });

  it('reproduce clones the pinned inputs into a new run owned by the admin, audits, enqueues', async () => {
    const out = await admin.reproduce('a1', 'r1', { ip: '9.9.9.9' });
    expect(out).toMatchObject({ status: 'QUEUED', sourceRunId: 'r1' });

    const clone = db.run.rows.find((r) => r.id === out.runId)!;
    expect(clone).toMatchObject({
      userId: 'a1', profileId: 'p1', baseResumeId: 'b1', ruleSetId: 'ruleset-1', jdId: 'j1',
      status: 'QUEUED', contactLocationOverride: 'London',
      settingsSnap: { toggles: { strictFactsMode: false } },
    });
    expect(enqueued).toEqual([{ runId: out.runId }]);
    expect(db.run.rows.find((r) => r.id === 'r1')!.userId).toBe('u1');   // original untouched
    expect(db.usageCounter.rows).toHaveLength(1);                          // no quota spent
    expect(db.adminAction.rows[0]).toMatchObject({
      adminId: 'a1', targetUserId: 'u1', action: 'admin.run.reproduce', ip: '9.9.9.9',
      meta: { sourceRunId: 'r1', newRunId: out.runId },
    });
    await expect(admin.reproduce('a1', 'missing')).rejects.toMatchObject({ status: 404 });
  });

  it('audit log resolves actor and target to emails, newest first', async () => {
    await new AuditService(db.asService()).record({ adminId: 'a1', targetUserId: 'u1', action: 'admin.2fa.enroll' });
    await new AuditService(db.asService()).record({ adminId: 'a1', action: 'admin.login' });
    const out = await admin.auditLog({});
    expect(out.items.map((i) => i.action)).toEqual(['admin.login', 'admin.2fa.enroll']);
    expect(out.items[1]).toMatchObject({ actor: 'admin@example.com', target: 'pro@example.com' });
  });
});

describe('SettingsService', () => {
  it('returns all ten toggles and applies a partial update', async () => {
    const s = new SettingsService(db.asService());
    db.userSettings.rows.push({ userId: 'u1', strictFactsMode: true, flagAndInclude: false, lockCompanyNames: true,
      lockEmploymentDates: true, blockOnUnusableJD: true, inferCompanyName: true, banHyphensInProse: true,
      consultingFraming: false, whinkGroupFraming: false, heritageLineDefault: false });
    expect(Object.keys(await s.get('u1'))).toHaveLength(10);
    const out = await s.put('u1', { whinkGroupFraming: true, strictFactsMode: false });
    expect(out).toMatchObject({ whinkGroupFraming: true, strictFactsMode: false, banHyphensInProse: true });
  });

  it('rejects unknown keys and non-booleans without changing anything', async () => {
    const s = new SettingsService(db.asService());
    db.userSettings.rows.push({ userId: 'u1', strictFactsMode: true });
    await expect(s.put('u1', { isAdmin: true })).rejects.toMatchObject({ code: 'UNKNOWN_SETTING', status: 400 });
    await expect(s.put('u1', { strictFactsMode: 'no' })).rejects.toMatchObject({ code: 'INVALID_SETTING' });
    expect(db.userSettings.rows[0]!.strictFactsMode).toBe(true);
  });
});

describe('BrandingService', () => {
  const agency = { id: 'u9', role: 'AGENCY' as const, isAdmin: false };
  const dto = { displayName: 'Acme Careers', footerText: 'Prepared by Acme', primaryColor: '#8b1a1a' };

  it('is Agency only (admins pass); saves and normalises the colour', async () => {
    const b = new BrandingService(db.asService());
    await expect(b.put({ id: 'u1', role: 'PRO', isAdmin: false }, dto)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(b.put({ id: 'u1', role: 'USER', isAdmin: false }, dto)).rejects.toMatchObject({ status: 403 });

    const saved = await b.put(agency, dto);
    expect(db.brandingConfig.rows[0]).toMatchObject({ userId: 'u9', displayName: 'Acme Careers', primaryColor: '#8B1A1A' });
    expect(saved).toMatchObject({ displayName: 'Acme Careers' });
    await expect(b.put({ id: 'a1', role: 'ADMIN', isAdmin: true }, { displayName: 'Whink' })).resolves.toBeTruthy();
  });

  it('get returns null before anything is saved', async () => {
    expect(await new BrandingService(db.asService()).get('nobody')).toBeNull();
  });
});
