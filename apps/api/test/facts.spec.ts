import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { FactsController } from '../src/facts/facts.controller';
import { FactsService } from '../src/facts/facts.service';
import { isParsableMetric, toEngineFact } from '../src/pipeline/facts';
import type { AuthUser } from '../src/auth/auth.types';
import { FakePrisma } from './fake-prisma';

const P1 = '3f2b8c1e-5d4a-4c8e-9b7a-1a2b3c4d5e6f';
const alice: AuthUser = { id: 'alice', role: 'PRO', isAdmin: false };
const bob: AuthUser = { id: 'bob', role: 'PRO', isAdmin: false };

let db: FakePrisma;
let svc: FactsService;

beforeEach(() => {
  db = new FakePrisma();
  svc = new FactsService(db.asService());
  db.profile.rows.push({ id: P1, userId: 'alice' });
});

const metric = (over: Record<string, unknown> = {}) => ({
  kind: 'metric' as const, claimText: 'Cut churn by 40%', metricValue: '40', metricUnit: '%',
  context: 'Platform team, 2023', ...over,
});

describe('create and list', () => {
  it('creates an unverified fact by default and trims text', async () => {
    const f = await svc.create(alice, P1, metric({ claimText: '  Cut churn by 40%  ', employer: ' Acme ' }));
    expect(f).toMatchObject({ profileId: P1, claimText: 'Cut churn by 40%', metricValue: '40', metricUnit: '%', employer: 'Acme', verified: false });
  });

  it('a metric needs a numeric value; other kinds do not', async () => {
    await expect(svc.create(alice, P1, metric({ metricValue: undefined }))).rejects.toMatchObject({ code: 'INVALID_METRIC', status: 422 });
    await expect(svc.create(alice, P1, metric({ metricValue: 'lots' }))).rejects.toMatchObject({ code: 'INVALID_METRIC' });
    await expect(svc.create(alice, P1, { kind: 'skill', claimText: 'SQL', context: 'x' })).resolves.toMatchObject({ kind: 'skill', metricValue: null });
    expect(['40', '1.2', '2M', '$2M', '1,200', '12 users'].every(isParsableMetric)).toBe(true);
    expect(['', 'abc', '4-5', '40%%'].some(isParsableMetric)).toBe(false);
  });

  it('checks that a role belongs to the profile', async () => {
    db.roleEntry.rows.push({ id: 'r-other', profileId: 'someone-else' });
    await expect(svc.create(alice, P1, metric({ roleId: 'r-other' }))).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
    db.roleEntry.rows.push({ id: 'r-mine', profileId: P1 });
    await expect(svc.create(alice, P1, metric({ roleId: 'r-mine' }))).resolves.toMatchObject({ roleId: 'r-mine' });
  });

  it('lists with kind and verified filters, verified first', async () => {
    await svc.create(alice, P1, metric({ claimText: 'B', verified: false }));
    await svc.create(alice, P1, metric({ claimText: 'A', verified: true }));
    await svc.create(alice, P1, { kind: 'skill', claimText: 'SQL', context: 'x', verified: true });

    expect((await svc.list(alice, P1, {})).map((f) => f.claimText)).toEqual(['A', 'SQL', 'B']);
    expect((await svc.list(alice, P1, { kind: 'metric' })).map((f) => f.claimText)).toEqual(['A', 'B']);
    expect((await svc.list(alice, P1, { verified: 'false' })).map((f) => f.claimText)).toEqual(['B']);
    expect((await svc.list(alice, P1, { kind: 'metric', verified: 'true' })).map((f) => f.claimText)).toEqual(['A']);
  });
});

describe('tenant isolation', () => {
  it("another user's profile or fact is a 404 everywhere", async () => {
    const f = await svc.create(alice, P1, metric());
    for (const call of [
      () => svc.list(bob, P1, {}), () => svc.create(bob, P1, metric()), () => svc.verify(bob, P1, [f.id]),
      () => svc.importFromBase(bob, P1, 'b1'), () => svc.update(bob, f.id, { context: 'x' }), () => svc.remove(bob, f.id),
    ]) await expect(call()).rejects.toMatchObject({ status: 404 });
    expect(db.factBankEntry.rows).toHaveLength(1);
  });
});

describe('update', () => {
  it('editing the claim withdraws verification; editing context does not', async () => {
    const f = await svc.create(alice, P1, metric({ verified: true }));

    expect((await svc.update(alice, f.id, { context: 'new context' })).verified).toBe(true);
    expect((await svc.update(alice, f.id, { metricValue: '90' })).verified).toBe(false);
    expect((await svc.update(alice, f.id, { verified: true })).verified).toBe(true);
    // an explicit verified in the same request wins
    expect((await svc.update(alice, f.id, { claimText: 'Cut churn by 90%', verified: true })).verified).toBe(true);
    expect((await svc.update(alice, f.id, { claimText: 'Cut churn by 90%' })).verified).toBe(true); // unchanged text
  });

  it('keeps a metric valid and can clear optional fields', async () => {
    const f = await svc.create(alice, P1, metric({ employer: 'Acme' }));
    await expect(svc.update(alice, f.id, { metricValue: null })).rejects.toMatchObject({ code: 'INVALID_METRIC' });
    await expect(svc.update(alice, f.id, { kind: 'skill', metricValue: null })).resolves.toMatchObject({ kind: 'skill', metricValue: null });
    expect((await svc.update(alice, f.id, { employer: null })).employer).toBeNull();
    await expect(svc.update(alice, 'missing', {})).rejects.toMatchObject({ code: 'FACT_NOT_FOUND' });
  });
});

describe('verify and remove', () => {
  it('verifies the ids that belong to the profile and reports the rest', async () => {
    const a = await svc.create(alice, P1, metric({ claimText: 'a' }));
    const b = await svc.create(alice, P1, metric({ claimText: 'b' }));
    db.factBankEntry.rows.push({ id: 'foreign', profileId: 'other', verified: false });

    const out = await svc.verify(alice, P1, [a.id, a.id, 'foreign', 'ghost']);
    expect(out).toEqual({ verified: 1, notFound: ['foreign', 'ghost'] });
    expect(db.factBankEntry.rows.find((r) => r.id === a.id)!.verified).toBe(true);
    expect(db.factBankEntry.rows.find((r) => r.id === b.id)!.verified).toBe(false);
    expect(db.factBankEntry.rows.find((r) => r.id === 'foreign')!.verified).toBe(false);
  });

  it('deletes', async () => {
    const f = await svc.create(alice, P1, metric());
    await svc.remove(alice, f.id);
    expect(db.factBankEntry.rows).toEqual([]);
  });
});

describe('import from base résumé', () => {
  const text = [
    'Jane Doe',
    'Led a team of 12 engineers and cut churn by 40% in 2023.',
    'Grew revenue from $2M to 5M users across 3 markets. Shipped 14 releases.',
    'No numbers here.',
  ].join('\n');

  beforeEach(() => {
    db.baseResume.rows.push({ id: 'b1', profileId: P1, version: 2, fileName: 'Jane Doe_PM_Acme.docx', parsedJson: { text } });
  });

  it('proposes unverified metrics with their sentence, skipping bare years', async () => {
    const out = await svc.importFromBase(alice, P1, 'b1');
    const rows = db.factBankEntry.rows;
    expect(out.created).toBe(rows.length);
    expect(rows.every((r) => r.verified === false && r.kind === 'metric')).toBe(true);

    const pairs = rows.map((r) => `${r.metricValue}${r.metricUnit ?? ''}`);
    expect(pairs).toEqual(expect.arrayContaining(['12engineers', '40%', '3', '14']));
    expect(pairs).not.toContain('2023');
    expect(rows.find((r) => r.metricValue === '40')).toMatchObject({
      claimText: 'Led a team of 12 engineers and cut churn by 40% in 2023.',
      sourceNote: 'Jane Doe_PM_Acme.docx (v2)', context: 'Imported from base résumé v2',
    });
  });

  it('what it proposes is usable by the validator once verified', async () => {
    await svc.importFromBase(alice, P1, 'b1');
    const five = db.factBankEntry.rows.find((r) => r.metricValue === '5')!;
    const engine = toEngineFact({ ...five, verified: true } as never);
    expect(engine).toMatchObject({ numeric: 5, unit: 'm', verified: true });
    expect(engine.aliases).toContain('5m');
  });

  it('is idempotent: a second import creates nothing', async () => {
    await svc.importFromBase(alice, P1, 'b1');
    const n = db.factBankEntry.rows.length;
    expect((await svc.importFromBase(alice, P1, 'b1')).created).toBe(0);
    expect(db.factBankEntry.rows).toHaveLength(n);
  });

  it('rejects a missing base or one without text', async () => {
    await expect(svc.importFromBase(alice, P1, 'nope')).rejects.toMatchObject({ code: 'BASE_RESUME_NOT_FOUND' });
    db.baseResume.rows.push({ id: 'b2', profileId: P1, version: 3, fileName: 'x', parsedJson: {} });
    await expect(svc.importFromBase(alice, P1, 'b2')).rejects.toMatchObject({ code: 'EMPTY_DOCUMENT' });
  });
});

describe('HTTP', () => {
  let app: INestApplication;
  let token: string;
  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [JwtModule.register({ global: true, secret: 's', signOptions: { algorithm: 'HS256' } })],
      controllers: [FactsController],
      providers: [FactsService, { provide: PrismaService, useValue: new FakePrisma() }],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    token = await app.get(JwtService).signAsync({ sub: 'alice', role: 'PRO', isAdmin: false });
    const fake = app.get(PrismaService) as unknown as FakePrisma;
    fake.profile.rows.push({ id: P1, userId: 'alice' });
  });
  afterAll(async () => { await app.close(); });

  it('requires a token', async () => {
    expect((await http().get(`/v1/profiles/${P1}/facts`)).status).toBe(401);
  });

  it('create validates the body, then returns 201; list and filters work', async () => {
    expect((await http().post(`/v1/profiles/${P1}/facts`).set('Authorization', auth()).send({ kind: 'nonsense', claimText: 'x', context: '' })).status).toBe(400);
    expect((await http().post(`/v1/profiles/${P1}/facts`).set('Authorization', auth()).send({ kind: 'metric', claimText: 'x', context: '', metricValue: 'abc' })).status).toBe(422);

    const ok = await http().post(`/v1/profiles/${P1}/facts`).set('Authorization', auth())
      .send({ kind: 'metric', claimText: 'Cut churn by 40%', metricValue: '40', metricUnit: '%', context: 'c', evil: 'dropped' });
    expect(ok.status).toBe(201);
    expect(ok.body.evil).toBeUndefined();

    const list = await http().get(`/v1/profiles/${P1}/facts?kind=metric&verified=false`).set('Authorization', auth());
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect((await http().get(`/v1/profiles/${P1}/facts?verified=maybe`).set('Authorization', auth())).status).toBe(400);
  });

  it('verify, patch and delete are wired to the right routes', async () => {
    const created = await http().post(`/v1/profiles/${P1}/facts`).set('Authorization', auth())
      .send({ kind: 'skill', claimText: 'SQL', context: 'c' });
    const id = created.body.id as string;

    expect((await http().post(`/v1/profiles/${P1}/facts/verify`).set('Authorization', auth()).send({ factIds: [] })).status).toBe(400);
    const v = await http().post(`/v1/profiles/${P1}/facts/verify`).set('Authorization', auth()).send({ factIds: [id] });
    expect(v.status).toBe(200);
    expect(v.body).toEqual({ verified: 1, notFound: [] });

    const p = await http().patch(`/v1/facts/${id}`).set('Authorization', auth()).send({ context: 'new' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ context: 'new', verified: true });

    expect((await http().delete('/v1/facts/not-a-uuid').set('Authorization', auth())).status).toBe(400);
    expect((await http().delete(`/v1/facts/${id}`).set('Authorization', auth())).status).toBe(204);
    expect((await http().delete(`/v1/facts/${id}`).set('Authorization', auth())).status).toBe(404);
  });
});
