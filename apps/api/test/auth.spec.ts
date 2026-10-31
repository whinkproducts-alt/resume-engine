import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as argon2 from 'argon2';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController, readCookie } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { sha256 } from '../src/auth/auth.constants';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { RateLimitService } from '../src/common/rate-limit/rate-limit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';

let db: FakePrisma;
let app: INestApplication;
let jwt: JwtService;

beforeAll(async () => {
  // cheap argon2 parameters: verify() reads them from the hash itself
  const passwordHash = await argon2.hash('Correct-Horse-9!', { type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1 });
  db = new FakePrisma();
  db.user.rows.push(
    { id: 'u1', email: 'user@example.com', passwordHash, role: 'USER', isAdmin: false, adminUnlimited: false, firstName: 'U', createdAt: new Date() },
    { id: 'a1', email: 'admin@example.com', passwordHash, role: 'ADMIN', isAdmin: true, adminUnlimited: true, firstName: 'A', createdAt: new Date() },
  );
  const mod = await Test.createTestingModule({
    imports: [JwtModule.register({ global: true, secret: 'test-secret', signOptions: { algorithm: 'HS256' } })],
    controllers: [AuthController],
    providers: [
      AuthService,
      { provide: PrismaService, useValue: db },
      { provide: RateLimitService, useValue: { consume: async () => undefined } },
    ],
  }).compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  jwt = app.get(JwtService);
});
afterAll(async () => { await app.close(); });
beforeEach(() => { db.session.rows.length = 0; db.adminAction.rows.length = 0; });

const server = () => app.getHttpServer();
const login = (email = 'user@example.com', headers: Record<string, string> = {}) =>
  request(server()).post('/v1/auth/login').set(headers).send({ email, password: 'Correct-Horse-9!' });
const cookieOf = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('re_refresh=')) ?? '';

describe('POST /v1/auth/login', () => {
  it('returns { user, accessToken } and sets the HttpOnly refresh cookie, not a body token', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 'u1', email: 'user@example.com', role: 'USER', isAdmin: false });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });

    const claims = await jwt.verifyAsync(res.body.accessToken);
    expect(claims).toMatchObject({ sub: 'u1', role: 'USER', isAdmin: false });
    expect(claims.jti).toBeTruthy();

    const cookie = cookieOf(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const raw = readCookie(cookie.split(';')[0], 're_refresh')!;
    expect(db.session.rows[0]!.refreshHash).toBe(sha256(raw));      // only the hash is stored
    expect(JSON.stringify(db.session.rows)).not.toContain(raw);
  });

  it('native clients also get the refresh token in the body', async () => {
    const res = await login('user@example.com', { 'X-Client-Platform': 'ios' });
    expect(typeof res.body.refreshToken).toBe('string');
  });

  it('rejects bad credentials with the same error for unknown user and wrong password', async () => {
    const a = await request(server()).post('/v1/auth/login').send({ email: 'nobody@example.com', password: 'x' });
    const b = await request(server()).post('/v1/auth/login').send({ email: 'user@example.com', password: 'wrong' });
    expect(a.status).toBe(401);
    expect(b.body).toEqual(a.body);
    expect(a.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('audits admin logins only', async () => {
    await login('user@example.com');
    expect(db.adminAction.rows).toEqual([]);
    await login('admin@example.com');
    expect(db.adminAction.rows).toMatchObject([{ adminId: 'a1', action: 'admin.login' }]);
  });
});

describe('refresh token rotation', () => {
  it('refreshes from the cookie, rotates it, and the new access token works on /auth/me', async () => {
    const first = await login();
    const c1 = cookieOf(first).split(';')[0]!;

    const second = await request(server()).post('/v1/auth/refresh').set('Cookie', c1).send({});
    expect(second.status).toBe(200);
    expect(second.body.accessToken).toBeTruthy();
    const c2 = cookieOf(second).split(';')[0]!;
    expect(c2).not.toBe(c1);
    expect(db.session.rows.filter((s) => !s.revokedAt)).toHaveLength(1);

    const me = await request(server()).get('/v1/auth/me').set('Authorization', `Bearer ${second.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: 'u1' });
  });

  it('reusing an already rotated token revokes every session of that user', async () => {
    const first = await login();
    const old = cookieOf(first).split(';')[0]!;
    const rotated = await request(server()).post('/v1/auth/refresh').set('Cookie', old).send({});
    const fresh = cookieOf(rotated).split(';')[0]!;

    const replay = await request(server()).post('/v1/auth/refresh').set('Cookie', old).send({});
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_REUSED');
    expect(db.session.rows.every((s) => s.revokedAt)).toBe(true);

    // the legitimate holder of the newest token is signed out too
    expect((await request(server()).post('/v1/auth/refresh').set('Cookie', fresh).send({})).status).toBe(401);
  });

  it('accepts the token in the body for native clients; rejects missing, unknown and expired', async () => {
    const res = await login('user@example.com', { 'X-Client-Platform': 'android' });
    const ok = await request(server()).post('/v1/auth/refresh').set('X-Client-Platform', 'android').send({ refreshToken: res.body.refreshToken });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.refreshToken).toBe('string');

    expect((await request(server()).post('/v1/auth/refresh').send({})).status).toBe(401);
    expect((await request(server()).post('/v1/auth/refresh').send({ refreshToken: 'unknown' })).status).toBe(401);

    const again = await login();
    db.session.rows.at(-1)!.expiresAt = new Date(Date.now() - 1000);
    const raw = readCookie(cookieOf(again).split(';')[0], 're_refresh')!;
    expect((await request(server()).post('/v1/auth/refresh').send({ refreshToken: raw })).status).toBe(401);
  });
});

describe('POST /v1/auth/logout', () => {
  it('revokes the session, clears the cookie, answers 204, and never errors', async () => {
    const res = await login();
    const c = cookieOf(res).split(';')[0]!;
    const out = await request(server()).post('/v1/auth/logout').set('Cookie', c).send({});
    expect(out.status).toBe(204);
    expect(cookieOf(out)).toMatch(/re_refresh=;/);
    expect(db.session.rows[0]!.revokedAt).toBeInstanceOf(Date);
    expect((await request(server()).post('/v1/auth/refresh').set('Cookie', c).send({})).status).toBe(401);
    expect((await request(server()).post('/v1/auth/logout').send({})).status).toBe(204);
  });
});

describe('readCookie', () => {
  it('finds a cookie among several and decodes it', () => {
    expect(readCookie('a=1; re_refresh=abc%2Bdef; b=2', 're_refresh')).toBe('abc+def');
    expect(readCookie(undefined, 'x')).toBeUndefined();
    expect(readCookie('xre_refresh=1', 're_refresh')).toBeUndefined();
  });
});
