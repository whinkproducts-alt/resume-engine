import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { RateLimitService } from '../src/common/rate-limit/rate-limit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AdminGuard } from '../src/auth/admin.guard';
import { Admin2faService } from '../src/admin/admin-2fa.service';
import { AdminController } from '../src/admin/admin.controller';
import { AdminOrBootstrapGuard } from '../src/admin/admin-or-bootstrap.guard';
import { RunsController } from '../src/runs/runs.controller';
import { RunsService } from '../src/runs/runs.service';

const UUID = '3f2b8c1e-5d4a-4c8e-9b7a-1a2b3c4d5e6f';
const UUID2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const runs = {
  create: vi.fn(), list: vi.fn(), get: vi.fn(), progress: vi.fn(), confirmCompany: vi.fn(),
  cancel: vi.fn(), retry: vi.fn(), output: vi.fn(), validation: vi.fn(), artifact: vi.fn(), remove: vi.fn(),
};
const twoFa = { enroll: vi.fn(), verify: vi.fn() };
const users: Record<string, { isAdmin: boolean; adminUnlimited: boolean; role: string }> = {
  'admin-1': { isAdmin: true, adminUnlimited: true, role: 'ADMIN' },
  'user-1': { isAdmin: false, adminUnlimited: false, role: 'USER' },
};

let app: INestApplication;
let tokenFor: (sub: string, role?: string, isAdmin?: boolean) => Promise<string>;

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    imports: [JwtModule.register({ global: true, secret: 'test-secret', signOptions: { algorithm: 'HS256' } })],
    controllers: [RunsController, AdminController],
    providers: [
      { provide: RunsService, useValue: runs },
      { provide: Admin2faService, useValue: twoFa },
      { provide: PrismaService, useValue: { user: { findUnique: async ({ where }: any) => users[where.id] ?? null } } },
      { provide: RateLimitService, useValue: { consume: async () => undefined } },
      AdminGuard,
      AdminOrBootstrapGuard,
    ],
  }).compile();

  app = mod.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  const jwt = app.get(JwtService);
  tokenFor = (sub, role = 'USER', isAdmin = false) => jwt.signAsync({ sub, role, isAdmin, jti: 'j' });
});

afterAll(async () => { await app.close(); });
beforeEach(() => { Object.values(runs).forEach((m) => m.mockReset()); Object.values(twoFa).forEach((m) => m.mockReset()); });

describe('runs endpoints', () => {
  it('401 without a token, in the standard error envelope', async () => {
    const res = await request(app.getHttpServer()).post('/v1/runs').send({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'UNAUTHORIZED' } });
  });

  it('POST /v1/runs validates the body, then answers 202', async () => {
    const auth = `Bearer ${await tokenFor('user-1')}`;
    const bad = await request(app.getHttpServer()).post('/v1/runs').set('Authorization', auth).send({ profileId: 'nope' });
    expect(bad.status).toBe(400);
    expect(runs.create).not.toHaveBeenCalled();

    runs.create.mockResolvedValue({ runId: UUID, status: 'QUEUED', eventsUrl: `/v1/runs/${UUID}/events` });
    const ok = await request(app.getHttpServer()).post('/v1/runs').set('Authorization', auth)
      .send({ profileId: UUID, jdId: UUID2, contactLocationOverride: 'London', extra: 'dropped' });
    expect(ok.status).toBe(202);
    expect(ok.body).toEqual({ runId: UUID, status: 'QUEUED', eventsUrl: `/v1/runs/${UUID}/events` });
    expect(runs.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      { profileId: UUID, jdId: UUID2, contactLocationOverride: 'London' },
    );
  });

  it('GET /v1/runs parses numeric query params and rejects bad ones', async () => {
    const auth = `Bearer ${await tokenFor('user-1')}`;
    runs.list.mockResolvedValue({ items: [], nextCursor: null });
    expect((await request(app.getHttpServer()).get('/v1/runs?limit=abc').set('Authorization', auth)).status).toBe(400);
    expect((await request(app.getHttpServer()).get('/v1/runs?limit=500').set('Authorization', auth)).status).toBe(400);
    const ok = await request(app.getHttpServer()).get(`/v1/runs?limit=5&status=COMPLETE&cursor=${UUID}`).set('Authorization', auth);
    expect(ok.status).toBe(200);
    expect(runs.list).toHaveBeenCalledWith(expect.anything(), { limit: 5, status: 'COMPLETE', cursor: UUID });
  });

  it('rejects a malformed run id before reaching the service', async () => {
    const auth = `Bearer ${await tokenFor('user-1')}`;
    expect((await request(app.getHttpServer()).get('/v1/runs/not-a-uuid').set('Authorization', auth)).status).toBe(400);
    expect(runs.get).not.toHaveBeenCalled();
  });

  it('maps service errors onto status codes, 404 for a missing run', async () => {
    const auth = `Bearer ${await tokenFor('user-1')}`;
    const { AppError } = await import('../src/common/errors/app-error');
    runs.get.mockRejectedValue(new AppError('RUN_NOT_FOUND', 404, 'Run not found.'));
    const res = await request(app.getHttpServer()).get(`/v1/runs/${UUID}`).set('Authorization', auth);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'RUN_NOT_FOUND', message: 'Run not found.' } });
  });

  it('confirm-company takes { companyName } and answers 200', async () => {
    const auth = `Bearer ${await tokenFor('user-1')}`;
    runs.confirmCompany.mockResolvedValue({ runId: UUID, status: 'REWRITING' });
    const res = await request(app.getHttpServer()).post(`/v1/runs/${UUID}/confirm-company`).set('Authorization', auth).send({ companyName: 'Stripe' });
    expect(res.status).toBe(200);
    expect(runs.confirmCompany).toHaveBeenCalledWith(expect.anything(), UUID, 'Stripe');
    expect((await request(app.getHttpServer()).post(`/v1/runs/${UUID}/confirm-company`).set('Authorization', auth).send({})).status).toBe(400);
  });

  it('docx: JSON by default (never cached), 302 with ?redirect=1', async () => {
    const auth = `Bearer ${await tokenFor('user-1')}`;
    runs.artifact.mockResolvedValue({ url: 'https://signed.test/a.docx', expiresAt: '2026-10-31T00:15:00Z' });
    const json = await request(app.getHttpServer()).get(`/v1/runs/${UUID}/docx`).set('Authorization', auth);
    expect(json.status).toBe(200);
    expect(json.headers['cache-control']).toBe('no-store');
    expect(json.body).toEqual({ url: 'https://signed.test/a.docx', expiresAt: '2026-10-31T00:15:00Z' });

    const redirect = await request(app.getHttpServer()).get(`/v1/runs/${UUID}/pdf?redirect=1`).set('Authorization', auth).redirects(0);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe('https://signed.test/a.docx');
    expect(runs.artifact).toHaveBeenLastCalledWith(expect.anything(), UUID, 'pdf');
  });

  it('DELETE answers 204', async () => {
    const auth = `Bearer ${await tokenFor('user-1')}`;
    runs.remove.mockResolvedValue(undefined);
    expect((await request(app.getHttpServer()).delete(`/v1/runs/${UUID}`).set('Authorization', auth)).status).toBe(204);
  });

  it('streams progress as server sent events and ends at a terminal state', async () => {
    const auth = `Bearer ${await tokenFor('user-1')}`;
    runs.progress
      .mockResolvedValueOnce({ status: 'REWRITING', stage: 'rewrite: summary', progress: 0.3, errorCode: null })
      .mockResolvedValue({ status: 'COMPLETE', stage: 'complete', progress: 1, errorCode: null });
    const res = await request(app.getHttpServer()).get(`/v1/runs/${UUID}/events`).set('Authorization', auth).buffer(true).parse((r, cb) => {
      let data = ''; r.on('data', (c) => (data += c)); r.on('end', () => cb(null, data));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = String(res.body).split('\n')
      .filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5)));
    expect(events.map((e) => e.status)).toEqual(['REWRITING', 'COMPLETE']);
  }, 15_000);
});

describe('POST /v1/admin/2fa/enroll', () => {
  const OLD = process.env.ADMIN_BOOTSTRAP_TOKEN;
  beforeAll(() => { process.env.ADMIN_BOOTSTRAP_TOKEN = 'bootstrap-secret'; });
  afterAll(() => { process.env.ADMIN_BOOTSTRAP_TOKEN = OLD; });

  it('is POST only (GET is not a route)', async () => {
    expect((await request(app.getHttpServer()).get('/v1/admin/2fa/enroll')).status).toBe(404);
  });

  it('rejects no credentials, a wrong token, and a missing adminId', async () => {
    expect((await request(app.getHttpServer()).post('/v1/admin/2fa/enroll').send({})).status).toBe(401);

    const wrong = await request(app.getHttpServer()).post('/v1/admin/2fa/enroll').set('X-Bootstrap-Token', 'nope').send({ adminId: UUID });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_BOOTSTRAP_TOKEN');

    const missing = await request(app.getHttpServer()).post('/v1/admin/2fa/enroll').set('X-Bootstrap-Token', 'bootstrap-secret').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('ADMIN_ID_REQUIRED');
    expect(twoFa.enroll).not.toHaveBeenCalled();
  });

  it('accepts the bootstrap token in the header (not the body) and enrolls the named admin', async () => {
    twoFa.enroll.mockResolvedValue({ adminId: UUID, secret: 'S' });
    const res = await request(app.getHttpServer()).post('/v1/admin/2fa/enroll').set('X-Bootstrap-Token', 'bootstrap-secret').send({ adminId: UUID });
    expect(res.status).toBe(201);
    expect(twoFa.enroll).toHaveBeenCalledWith(UUID, expect.any(Object));

    const bodyToken = await request(app.getHttpServer()).post('/v1/admin/2fa/enroll').send({ adminId: UUID, bootstrapToken: 'bootstrap-secret' });
    expect(bodyToken.status).toBe(401);
  });

  it('lets a signed in admin enroll themselves; re-checks the database, not the JWT claim', async () => {
    twoFa.enroll.mockResolvedValue({ adminId: 'admin-1' });
    const ok = await request(app.getHttpServer()).post('/v1/admin/2fa/enroll').set('Authorization', `Bearer ${await tokenFor('admin-1', 'ADMIN', true)}`).send({});
    expect(ok.status).toBe(201);
    expect(twoFa.enroll).toHaveBeenCalledWith('admin-1', expect.any(Object));

    // a token that CLAIMS admin for someone the database says is not one
    const forged = await request(app.getHttpServer()).post('/v1/admin/2fa/enroll').set('Authorization', `Bearer ${await tokenFor('user-1', 'ADMIN', true)}`).send({});
    expect(forged.status).toBe(404);
  });

  it('verify takes a 6 to 8 character code', async () => {
    const auth = `Bearer ${await tokenFor('admin-1', 'ADMIN', true)}`;
    twoFa.verify.mockResolvedValue({ adminId: 'admin-1', enabled: true });
    expect((await request(app.getHttpServer()).post('/v1/admin/2fa/verify').set('Authorization', auth).send({ code: '12' })).status).toBe(400);
    expect((await request(app.getHttpServer()).post('/v1/admin/2fa/verify').set('Authorization', auth).send({ code: '123456' })).status).toBe(200);
  });
});
