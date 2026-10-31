// apps/api/src/runs/quota.service.ts
// Stage 0, the quota gate (01-SPEC-v3.md section 2.3). Server side, never trust the client.

import { Injectable } from '@nestjs/common';
import type { Prisma, UserRole } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';

export const PRO_RUNS_PER_MONTH = 10;

export interface QuotaUser {
  id: string;
  role: UserRole;
  isAdmin: boolean;
  adminUnlimited: boolean;
}

export function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7); // 'YYYY-MM'
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws 402 RUN_LIMIT_REACHED or NO_CREDITS. Reads only; see consume(). */
  async assertCanRun(user: QuotaUser, db: Tx | PrismaService = this.prisma, now = new Date()): Promise<void> {
    if (user.isAdmin && user.adminUnlimited) return;
    if (user.role === 'AGENCY') return;

    if (user.role === 'PRO') {
      const row = await db.usageCounter.findUnique({
        where: { userId_period: { userId: user.id, period: currentPeriod(now) } },
      });
      if ((row?.runsUsed ?? 0) >= PRO_RUNS_PER_MONTH) {
        throw new AppError('RUN_LIMIT_REACHED', 402, 'Monthly run limit reached.');
      }
      return;
    }

    const credits = await this.remainingCredits(user.id, db, now);
    if (credits < 1) throw new AppError('NO_CREDITS', 402, 'No run credits remaining.');
  }

  async remainingCredits(userId: string, db: Tx | PrismaService = this.prisma, now = new Date()): Promise<number> {
    const rows = await db.runCredit.findMany({
      where: { userId, remaining: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { remaining: true },
    });
    return rows.reduce((n, r) => n + r.remaining, 0);
  }

  /** Spends one run. Call inside the same transaction that creates the run. */
  async consume(user: QuotaUser, db: Tx, now = new Date()): Promise<void> {
    if (user.isAdmin && user.adminUnlimited) return;
    if (user.role === 'AGENCY') return;

    if (user.role === 'PRO') {
      const period = currentPeriod(now);
      await db.usageCounter.upsert({
        where: { userId_period: { userId: user.id, period } },
        create: { userId: user.id, period, runsUsed: 1 },
        update: { runsUsed: { increment: 1 } },
      });
      return;
    }

    // Spend the credit that expires soonest first.
    const credit = await db.runCredit.findFirst({
      where: { userId: user.id, remaining: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    if (!credit) throw new AppError('NO_CREDITS', 402, 'No run credits remaining.');
    await db.runCredit.update({ where: { id: credit.id }, data: { remaining: { decrement: 1 } } });
  }
}
