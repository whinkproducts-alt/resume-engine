// apps/api/src/admin/admin-read.service.ts
// Admin panel data (01-SPEC-v3.md section 7.11) and the reproduce action.

import { Injectable } from '@nestjs/common';
import { RunStatus } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../runs/queue.service';
import { PRO_RUNS_PER_MONTH, currentPeriod } from '../runs/quota.service';
import { presentFlag } from '../runs/runs.service';
import { AuditService } from './audit.service';
import type { RequestMeta } from './admin-2fa.service';

const clampLimit = (n: number | undefined, d = 20) => Math.min(Math.max(n ?? d, 1), 100);

@Injectable()
export class AdminReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  async users(q: { limit?: number; cursor?: string }) {
    const limit = clampLimit(q.limit);
    const rows = await this.prisma.user.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true, email: true, role: true, isAdmin: true, firstName: true,
        lastName: true, createdAt: true, totpEnabledAt: true,
      },
    });
    const page = rows.slice(0, limit);
    const usage = await this.prisma.usageCounter.findMany({
      where: { userId: { in: page.map((u) => u.id) }, period: currentPeriod() },
    });
    const used = new Map(usage.map((u) => [u.userId, u.runsUsed]));
    return {
      items: page.map((u) => ({
        id: u.id,
        email: u.email,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
        role: u.role,
        isAdmin: u.isAdmin,
        totpEnabled: Boolean(u.totpEnabledAt),
        runsThisMonth: used.get(u.id) ?? 0,
        runsLimit: u.role === 'PRO' ? PRO_RUNS_PER_MONTH : null,
        createdAt: u.createdAt,
      })),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async runs(q: { status?: string; limit?: number; cursor?: string }) {
    const limit = clampLimit(q.limit);
    const status = q.status && q.status in RunStatus ? (q.status as RunStatus) : undefined;
    if (q.status && !status) throw new AppError('INVALID_STATUS', 400, 'Unknown status filter.');

    const rows = await this.prisma.run.findMany({
      where: status ? { status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: {
        user: { select: { email: true } },
        jd: { select: { company: true, roleTitle: true } },
      },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id, status: r.status, stage: r.stage, progress: r.progress,
        userId: r.userId, userEmail: r.user.email, planTier: r.planTier,
        company: r.jd.company, roleTitle: r.jd.roleTitle, errorCode: r.errorCode,
        actualTokens: r.actualTokens, pageCount: r.pageCount,
        createdAt: r.createdAt, finishedAt: r.finishedAt,
      })),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /** Full run with logs, flags and the versions needed to reproduce it. */
  async runDetail(id: string) {
    const run = await this.prisma.run.findUnique({
      where: { id },
      include: { ruleSet: { select: { version: true, promptVersion: true } } },
    });
    if (!run) throw new AppError('RUN_NOT_FOUND', 404, 'Run not found.');

    const [logs, flags, base] = await Promise.all([
      this.prisma.runLog.findMany({ where: { runId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.validationFlag.findMany({ where: { runId: id }, orderBy: { id: 'asc' } }),
      this.prisma.baseResume.findUnique({ where: { id: run.baseResumeId }, select: { version: true } }),
    ]);
    return {
      run: {
        id: run.id, status: run.status, stage: run.stage, progress: run.progress,
        userId: run.userId, profileId: run.profileId, jdId: run.jdId, planTier: run.planTier,
        errorCode: run.errorCode, pageCount: run.pageCount, keywordCount: run.keywordCount,
        actualTokens: run.actualTokens, createdAt: run.createdAt,
        startedAt: run.startedAt, finishedAt: run.finishedAt,
      },
      logs,
      flags: flags.map(presentFlag),
      versions: {
        ruleSet: run.ruleSet.version,
        promptVersion: run.ruleSet.promptVersion,
        baseResume: base?.version ?? null,
        models: [...new Set(logs.map((l) => l.modelId).filter((m): m is string => Boolean(m)))],
      },
    };
  }

  /**
   * Re-runs a run with its pinned RuleSet, PromptVersion, BaseResume and settings
   * snapshot. The new run belongs to the admin, so the original owner's history and
   * quota are untouched.
   */
  async reproduce(adminId: string, sourceId: string, meta: RequestMeta = {}) {
    const src = await this.prisma.run.findUnique({ where: { id: sourceId } });
    if (!src) throw new AppError('RUN_NOT_FOUND', 404, 'Run not found.');

    const run = await this.prisma.run.create({
      data: {
        userId: adminId,
        profileId: src.profileId,
        baseResumeId: src.baseResumeId,
        ruleSetId: src.ruleSetId,
        jdId: src.jdId,
        planTier: src.planTier,
        status: 'QUEUED',
        stage: 'queued',
        progress: 0,
        contactLocationOverride: src.contactLocationOverride,
        settingsSnap: src.settingsSnap ?? {},
      },
      select: { id: true, status: true },
    });
    await this.audit.record({
      adminId, targetUserId: src.userId, action: 'admin.run.reproduce',
      meta: { sourceRunId: sourceId, newRunId: run.id }, ...meta,
    });
    await this.queue.enqueue({ runId: run.id });
    return { runId: run.id, status: run.status, sourceRunId: sourceId };
  }

  async auditLog(q: { limit?: number; cursor?: string }) {
    const limit = clampLimit(q.limit, 50);
    const rows = await this.prisma.adminAction.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    const ids = [...new Set(page.flatMap((r) => [r.adminId, r.targetUserId].filter((x): x is string => Boolean(x))))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
    const email = new Map(users.map((u) => [u.id, u.email]));
    return {
      items: page.map((r) => ({
        id: r.id,
        actor: email.get(r.adminId) ?? r.adminId,
        action: r.action,
        target: r.targetUserId ? (email.get(r.targetUserId) ?? r.targetUserId) : null,
        ip: r.ip,
        createdAt: r.createdAt,
        meta: r.meta,
      })),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
