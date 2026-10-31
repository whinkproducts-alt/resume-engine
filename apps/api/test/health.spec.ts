import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { HealthController } from '../src/health/health.controller';
import { PrismaService } from '../src/prisma/prisma.service';

let dbUp = true;
let app: INestApplication;

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{
      provide: PrismaService,
      useValue: { $queryRaw: async () => { if (!dbUp) throw new Error('down'); return [{ '?column?': 1 }]; } },
    }],
  }).compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
});
afterAll(async () => { await app.close(); });

describe('health', () => {
  it('healthz needs nothing and needs no token', async () => {
    dbUp = false;
    const res = await request(app.getHttpServer()).get('/v1/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('readyz is 200 with the database and 503 without', async () => {
    dbUp = true;
    expect((await request(app.getHttpServer()).get('/v1/readyz')).body).toEqual({ ok: true, db: true });
    dbUp = false;
    const down = await request(app.getHttpServer()).get('/v1/readyz');
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe('NOT_READY');
  });
});
