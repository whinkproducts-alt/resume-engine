// apps/api/src/auth/admin.guard.ts
// 01-SPEC-v3.md section 3.3: "For every admin-guarded request, re-fetch the user
// row from the DB (do not trust JWT claims for admin-only routes)."

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthUser } from './auth.types';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly jwtGuard: JwtAuthGuard;

  constructor(jwt: JwtService, private readonly prisma: PrismaService) {
    this.jwtGuard = new JwtAuthGuard(jwt);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.jwtGuard.canActivate(context);
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const id = req.user?.id;
    const row = id
      ? await this.prisma.user.findUnique({
          where: { id }, select: { isAdmin: true, adminUnlimited: true, role: true },
        })
      : null;
    // Not an admin: 404, so the admin surface is not revealed.
    if (!row || !row.isAdmin || !row.adminUnlimited || row.role !== 'ADMIN') {
      throw new AppError('NOT_FOUND', 404, 'Not found.');
    }
    if (req.user) req.user = { ...req.user, isAdmin: true, role: row.role };
    return true;
  }
}
