// apps/api/src/runs/runs.service.ts
// Run endpoints from 01-SPEC-v3.md section 7.7. Tenant isolation: every query
// filters by userId, and another user's run is a 404, never a 403 (section 13).

import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, RunStatus } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { buildSnapshot } from '../pipeline/prisma-repo';
import { ensureDefaultRuleSet } from '../pipeline/rule-set';
import { resolveBaseResumeId } from './base-resume.util';
import { pickSettings, type CreateRunDto } from './dto/create-run.dto';
import { QuotaService } from './quota.service';
import { QueueService } from './queue.service';
import { StorageService } from './storage.service';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TERMINAL: RunStatus[] = ['COMPLETE', 'FAILED', 'CANCELLED'];
const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.includes(status);
}

/** The schema stores a flag's rule id as a code prefix: "R2:HEADLINE_ROLE_MISMATCH". */
export function presentFlag(f: { id: string; code: string; severity: string; field: string | null; message: string }) {
  const [head, ...rest] = f.code.split(':');
  const hasRule = rest.length > 0;
  return {
    id: f.id,
    ruleId: hasRule ? (head as string) : null,
    code: hasRule ? rest.join(':') : f.code,
    severity: f.severity,
    blocking: f.severity === 'error',
    field: f.field,
    message: f.message,
  };
}

@Injectable()
export class RunsService implements OnModuleInit {
  private ruleSetId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Best effort at boot; create() retries if the database was not ready.
    await this.getRuleSetId().catch(() => undefined);
  }

  private async getRuleSetId(): Promise<string> {
    if (!this.ruleSetId) {
      const models = {
        analyze: process.env.LLM_MODEL_ANALYZE ?? 'unset',
        write: process.env.LLM_MODEL_WRITE ?? 'unset',
      };
      this.ruleSetId = (await ensureDefaultRuleSet(this.prisma, models)).id;
    }
    return this.ruleSetId;
  }

  private async owned(user: AuthUser, id: string) {
    const run = await this.prisma.run.findFirst({ where: { id, userId: user.id } });
    if (!run) throw new AppError('RUN_NOT_FOUND', 404, 'Run not found.');
    return run;
  }

  /* ---------------------------------- create --------------------------------- */

  async create(user: AuthUser, dto: CreateRunDto) {
    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, role: true, isAdmin: true, adminUnlimited: true },
    });
    if (!account) throw new AppError('UNAUTHORIZED', 401);

    const profile = await this.prisma.profile.findFirst({
      where: { id: dto.profileId, userId: user.id },
      include: { settings: true },
    });
    if (!profile) throw new AppError('PROFILE_NOT_FOUND', 404);

    const jd = await this.prisma.jobDescription.findFirst({
      where: { id: dto.jdId, userId: user.id, profileId: profile.id },
    });
    if (!jd) throw new AppError('JD_NOT_FOUND', 404);

    const baseResumeId = await resolveBaseResumeId(this.prisma, profile.id, dto.baseResumeId ?? null);
    if (dto.baseResumeId) {
      const base = await this.prisma.baseResume.findFirst({
        where: { id: dto.baseResumeId, profileId: profile.id },
      });
      if (!base) throw new AppError('BASE_RESUME_NOT_FOUND', 404);
    }

    const ruleSetId = await this.getRuleSetId();

    const stored = await this.prisma.userSettings.upsert({
      where: { userId: user.id }, create: { userId: user.id }, update: {},
    });
    const { id: _id, userId: _uid, ...settings } = stored;
    const merged = { ...settings, ...pickSettings(dto.settingsOverride) };
    const snapshot = buildSnapshot(merged, profile.settings?.overrides);

    const run = await this.prisma.$transaction(async (tx) => {
      await this.quota.assertCanRun(account, tx);
      await this.quota.consume(account, tx);
      return tx.run.create({
        data: {
          userId: user.id,
          profileId: profile.id,
          baseResumeId,
          ruleSetId,
          jdId: jd.id,
          planTier: account.role,
          status: 'QUEUED',
          stage: 'queued',
          progress: 0,
          contactLocationOverride: dto.contactLocationOverride?.trim() || null,
          settingsSnap: json(snapshot),
        },
        select: { id: true, status: true },
      });
    });

    await this.queue.enqueue({ runId: run.id });
    return { runId: run.id, status: run.status, eventsUrl: `/v1/runs/${run.id}/events` };
  }

  /* ----------------------------------- reads ---------------------------------- */

  async list(user: AuthUser, q: { status?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    const status = q.status && q.status in RunStatus ? (q.status as RunStatus) : undefined;
    if (q.status && !status) throw new AppError('INVALID_STATUS', 400, 'Unknown status filter.');

    const rows = await this.prisma.run.findMany({
      where: { userId: user.id, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { jd: { select: { company: true, roleTitle: true } }, profile: { select: { name: true } } },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        status: r.status,
        stage: r.stage,
        progress: r.progress,
        profileId: r.profileId,
        profileName: r.profile.name,
        jdId: r.jdId,
        company: r.jd.company,
        roleTitle: r.jd.roleTitle,
        errorCode: r.errorCode,
        pageCount: r.pageCount,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt,
      })),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async get(user: AuthUser, id: string) {
    const run = await this.prisma.run.findFirst({
      where: { id, userId: user.id },
      include: { jd: { select: { company: true, companyInferred: true, companyConfidence: true, roleTitle: true } } },
    });
    if (!run) throw new AppError('RUN_NOT_FOUND', 404, 'Run not found.');
    return {
      id: run.id,
      status: run.status,
      stage: run.stage,
      progress: run.progress,
      profileId: run.profileId,
      jdId: run.jdId,
      baseResumeId: run.baseResumeId,
      companyConfirmed: run.companyConfirmed,
      pendingCompany: run.status === 'AWAITING_COMPANY_CONFIRM'
        ? {
            name: run.jd.company,
            inferred: run.jd.companyInferred,
            confidence: run.jd.companyConfidence,
          }
        : null,
      roleTitle: run.jd.roleTitle,
      pageCount: run.pageCount,
      keywordCount: run.keywordCount,
      errorCode: run.errorCode,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };
  }

  /** Lightweight progress snapshot used by the SSE stream. */
  async progress(user: AuthUser, id: string) {
    const run = await this.prisma.run.findFirst({
      where: { id, userId: user.id },
      select: { status: true, stage: true, progress: true, errorCode: true },
    });
    if (!run) throw new AppError('RUN_NOT_FOUND', 404, 'Run not found.');
    return run;
  }

  async output(user: AuthUser, id: string) {
    const run = await this.owned(user, id);
    if (!run.outputJson) {
      throw new AppError('OUTPUT_NOT_READY', 409, 'No output has been produced yet.');
    }
    const targetCompanies = await this.prisma.alignedCompany.findMany({
      where: { runId: id }, orderBy: { rank: 'asc' },
      select: { rank: true, name: true, department: true, exampleRole: true, isTarget: true },
    });
    return {
      outputJson: run.outputJson,
      atsScore: run.atsScore,
      metrics: run.metrics,
      keywordCount: run.keywordCount,
      targetCompanies,
      validation: run.validation,
    };
  }

  async validation(user: AuthUser, id: string) {
    const run = await this.owned(user, id);
    const rows = await this.prisma.validationFlag.findMany({ where: { runId: id }, orderBy: { id: 'asc' } });
    const flags = rows.map(presentFlag);
    const v = run.validation as { passed?: boolean } | null;
    if (!v && flags.length === 0) {
      throw new AppError('VALIDATION_NOT_READY', 409, 'Validation has not run yet.');
    }
    return {
      passed: v?.passed ?? !flags.some((f) => f.blocking),
      flags,
      counts: {
        total: flags.length,
        blocking: flags.filter((f) => f.blocking).length,
        warnings: flags.filter((f) => f.severity === 'warn').length,
        infos: flags.filter((f) => f.severity === 'info').length,
      },
    };
  }

  async artifact(user: AuthUser, id: string, kind: 'docx' | 'pdf') {
    const run = await this.owned(user, id);
    const key = kind === 'docx' ? run.docxKey : run.pdfKey;
    if (!key) {
      throw new AppError(kind === 'docx' ? 'DOCX_NOT_READY' : 'PDF_NOT_READY', 409,
        `The ${kind.toUpperCase()} is not available.`);
    }
    const ref = await this.storage.ref(key, kind === 'docx' ? DOCX_TYPE : 'application/pdf');
    return { url: ref.url, expiresAt: ref.expiresAt };
  }

  /* ---------------------------------- actions --------------------------------- */

  /** POST /runs/:id/confirm-company: unblocks stage 3 and continues at stage 4. */
  async confirmCompany(user: AuthUser, id: string, companyName: string) {
    const name = companyName.trim();
    if (name.length < 2) throw new AppError('INVALID_COMPANY', 400, 'Company name is too short.');
    const run = await this.owned(user, id);
    if (run.status !== 'AWAITING_COMPANY_CONFIRM') {
      throw new AppError('RUN_NOT_AWAITING_CONFIRM', 409, `Run is ${run.status}.`);
    }
    // Compare-and-set on status so a double click cannot enqueue twice.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const res = await tx.run.updateMany({
        where: { id, status: 'AWAITING_COMPANY_CONFIRM' },
        data: { status: 'REWRITING', stage: 'rewrite', companyConfirmed: true },
      });
      if (res.count === 0) return false;
      await tx.jobDescription.update({
        where: { id: run.jdId },
        data: { company: name, companyInferred: false, companyConfidence: 1 },
      });
      return true;
    });
    if (!claimed) throw new AppError('RUN_NOT_AWAITING_CONFIRM', 409, 'Run was already confirmed.');
    await this.queue.enqueue({ runId: id, resumeFrom: 'rewrite' });
    return { runId: id, status: 'REWRITING' as const };
  }

  async cancel(user: AuthUser, id: string) {
    const run = await this.owned(user, id);
    if (isTerminal(run.status)) {
      throw new AppError('RUN_NOT_CANCELLABLE', 409, `Run is already ${run.status}.`);
    }
    await this.prisma.run.update({
      where: { id },
      data: { status: 'CANCELLED', stage: 'cancelled', finishedAt: new Date() },
    });
    return { runId: id, status: 'CANCELLED' as const };
  }

  /** POST /runs/:id/retry: re-runs a failed run from the start. Does not spend another credit. */
  async retry(user: AuthUser, id: string) {
    const run = await this.owned(user, id);
    if (run.status !== 'FAILED') {
      throw new AppError('RUN_NOT_RETRYABLE', 409, `Only failed runs can be retried; this one is ${run.status}.`);
    }
    const res = await this.prisma.run.updateMany({
      where: { id, status: 'FAILED' },
      data: { status: 'QUEUED', stage: 'queued', progress: 0, errorCode: null, finishedAt: null },
    });
    if (res.count === 0) throw new AppError('RUN_NOT_RETRYABLE', 409, 'Run changed state.');
    await this.queue.enqueue({ runId: id });
    return { runId: id, status: 'QUEUED' as const };
  }

  async remove(user: AuthUser, id: string) {
    const run = await this.owned(user, id);
    if (!isTerminal(run.status)) {
      throw new AppError('RUN_IN_PROGRESS', 409, 'Cancel the run before deleting it.');
    }
    await this.prisma.$transaction([
      this.prisma.runLog.deleteMany({ where: { runId: id } }),
      this.prisma.validationFlag.deleteMany({ where: { runId: id } }),
      this.prisma.keywordSet.deleteMany({ where: { runId: id } }),
      this.prisma.alignedCompany.deleteMany({ where: { runId: id } }),
      this.prisma.document.deleteMany({ where: { runId: id } }),
      this.prisma.run.delete({ where: { id } }),
    ]);
  }
}
