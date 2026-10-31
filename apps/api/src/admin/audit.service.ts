// apps/api/src/admin/audit.service.ts
// Every admin action is audited (01-SPEC-v3.md section 7.11, section 13).

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(entry: {
    adminId: string;
    action: string;
    targetUserId?: string | null;
    meta?: Prisma.InputJsonValue;
    ip?: string;
    userAgent?: string;
  }) {
    return this.prisma.adminAction.create({
      data: {
        adminId: entry.adminId,
        action: entry.action,
        targetUserId: entry.targetUserId ?? null,
        ...(entry.meta !== undefined ? { meta: entry.meta } : {}),
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }
}
