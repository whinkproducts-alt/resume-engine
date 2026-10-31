// apps/api/src/admin/admin-or-bootstrap.guard.ts
// Two ways to reach the 2FA endpoints:
//  1. A signed in admin (JWT, re-checked against the database): acts on themselves.
//  2. A valid X-Bootstrap-Token header (first run, before 2FA exists): body.adminId names the target.

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { AppError } from '../common/errors/app-error';
import { RateLimitService } from '../common/rate-limit/rate-limit.service';

export type AdminRequest = Request & { user?: { id: string }; adminTargetId?: string };

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

@Injectable()
export class AdminOrBootstrapGuard implements CanActivate {
  constructor(
    private readonly adminGuard: AdminGuard,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const provided = req.header('x-bootstrap-token');

    if (provided === undefined) {
      await this.adminGuard.canActivate(context);
      req.adminTargetId = req.user?.id;
      return true;
    }

    await this.rateLimit.consume(`2fa-bootstrap:${req.ip ?? 'unknown'}`, 10, 60 * 60);
    const expected = process.env.ADMIN_BOOTSTRAP_TOKEN;
    if (!expected || !provided || !safeEqual(provided, expected)) {
      throw new AppError('INVALID_BOOTSTRAP_TOKEN', 401, 'X-Bootstrap-Token header missing or invalid.');
    }
    const target = (req.body as { adminId?: unknown } | undefined)?.adminId;
    if (typeof target !== 'string' || !target) {
      throw new AppError('ADMIN_ID_REQUIRED', 400, 'adminId is required.');
    }
    req.adminTargetId = target;
    return true;
  }
}
