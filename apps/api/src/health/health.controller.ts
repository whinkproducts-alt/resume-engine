// apps/api/src/health/health.controller.ts
// GET /v1/healthz: the process is up (no dependencies, for liveness).
// GET /v1/readyz:  the database answers (for load balancers and deploy checks).

import { Controller, Get } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz')
  healthz() {
    return { ok: true };
  }

  @Get('readyz')
  async readyz() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new AppError('NOT_READY', 503, 'The database is not reachable.');
    }
    return { ok: true, db: true };
  }
}
