// apps/api/src/pipeline/prisma-repo.ts
// PipelineRepo backed by the Prisma schema (the source of truth).

import { Prisma, type PrismaClient } from '@prisma/client';
import { DEFAULT_TOGGLES, type RuleToggles, type ValidationFlag } from '@resume-engine/rules';
import { toEngineFact } from './facts';
import type {
  AnalysisResult, CompletionRecord, PipelineRepo, RunContext, RunStatusName,
  SettingsSnapshot, StepLog,
} from './types';

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const ym = (d: Date): string => d.toISOString().slice(0, 7);

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

export function parseSnapshot(raw: unknown): SettingsSnapshot {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const t = (o.toggles && typeof o.toggles === 'object' ? o.toggles : {}) as Partial<RuleToggles>;
  return {
    toggles: {
      banHyphensInProse: t.banHyphensInProse ?? DEFAULT_TOGGLES.banHyphensInProse,
      whinkGroupFraming: t.whinkGroupFraming ?? DEFAULT_TOGGLES.whinkGroupFraming,
      strictFactsMode: t.strictFactsMode ?? DEFAULT_TOGGLES.strictFactsMode,
    },
    userSettings: (o.userSettings && typeof o.userSettings === 'object'
      ? o.userSettings : {}) as Record<string, unknown>,
    profileOverrides: (o.profileOverrides && typeof o.profileOverrides === 'object'
      ? o.profileOverrides : null) as Record<string, unknown> | null,
  };
}

/** Snapshot taken when a run is created and stored in Run.settingsSnap. */
export function buildSnapshot(
  userSettings: {
    strictFactsMode: boolean; banHyphensInProse: boolean; whinkGroupFraming: boolean;
  } & Record<string, unknown>,
  profileOverrides: unknown,
): SettingsSnapshot {
  return {
    toggles: {
      strictFactsMode: userSettings.strictFactsMode,
      banHyphensInProse: userSettings.banHyphensInProse,
      whinkGroupFraming: userSettings.whinkGroupFraming,
    },
    userSettings,
    profileOverrides:
      profileOverrides && typeof profileOverrides === 'object'
        ? (profileOverrides as Record<string, unknown>) : null,
  };
}

export class PrismaPipelineRepo implements PipelineRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async loadContext(runId: string): Promise<RunContext | null> {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      include: { jd: true, user: { select: { role: true } }, ruleSet: { select: { version: true } } },
    });
    if (!run) return null;

    const [profile, base] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { id: run.profileId },
        include: {
          roles: { orderBy: { orderIndex: 'asc' } },
          education: { orderBy: [{ startYear: 'desc' }, { institution: 'asc' }] },
          certs: { orderBy: [{ year: 'desc' }, { name: 'asc' }] },
          facts: true,
        },
      }),
      this.prisma.baseResume.findUnique({ where: { id: run.baseResumeId } }),
    ]);
    if (!profile) return null;
    if (!base) return null;

    const parsed = (base.parsedJson && typeof base.parsedJson === 'object'
      ? base.parsedJson : {}) as { text?: unknown; keywords?: unknown };

    const branding = run.user.role === 'AGENCY'
      ? await this.prisma.brandingConfig.findUnique({ where: { userId: run.userId } })
      : null;

    return {
      run: {
        id: run.id,
        userId: run.userId,
        status: run.status,
        companyConfirmed: run.companyConfirmed,
        contactLocationOverride: run.contactLocationOverride,
        startedAt: run.startedAt,
        outputJson: run.outputJson,
        ruleSetVersion: run.ruleSet.version,
      },
      jd: {
        id: run.jd.id,
        rawText: run.jd.rawText,
        company: run.jd.company,
        roleTitle: run.jd.roleTitle,
        location: run.jd.location,
        seniority: run.jd.seniority,
        industryTags: run.jd.industryTags,
        responsibilities: asStrings(run.jd.responsibilities),
        requirements: asStrings(run.jd.requirements),
        keywords: run.jd.keywords,
        companyInferred: run.jd.companyInferred,
        companyConfidence: run.jd.companyConfidence,
      },
      profile: {
        id: profile.id,
        fullName: profile.headerFullName,
        city: profile.headerCity,
        phones: profile.headerPhones,
        email: profile.headerEmail,
        linkedIn: profile.linkedIn,
        roles: profile.roles.map((r) => ({
          company: r.companyName,
          baseTitle: r.baseTitle,
          startDate: ym(r.startDate),
          endDate: r.endDate ? ym(r.endDate) : null,
          location: r.location,
          baseFlagship: r.baseFlagship,
          baseBullets: asStrings(r.baseBullets),
        })),
        education: profile.education.map((e) => ({
          institution: e.institution, degree: e.degree, field: e.field,
          startYear: e.startYear, endYear: e.endYear,
        })),
        certifications: profile.certs.map((c) => ({ name: c.name, issuer: c.issuer, year: c.year })),
        facts: profile.facts.map(toEngineFact),
      },
      base: {
        id: base.id,
        version: base.version,
        text: typeof parsed.text === 'string' ? parsed.text : '',
        keywords: asStrings(parsed.keywords),
      },
      snapshot: parseSnapshot(run.settingsSnap),
      branding: branding
        ? { primaryColor: branding.primaryColor, footerText: branding.footerText }
        : null,
    };
  }

  async setStatus(
    runId: string,
    status: RunStatusName,
    patch: Parameters<PipelineRepo['setStatus']>[2] = {},
  ): Promise<void> {
    // A user cancellation wins over any later status write from the worker.
    await this.prisma.run.updateMany({
      where: { id: runId, ...(status === 'CANCELLED' ? {} : { NOT: { status: 'CANCELLED' } }) },
      data: {
        status,
        ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
        ...(patch.progress !== undefined
          ? { progress: Math.max(0, Math.min(1, patch.progress)) } : {}),
        ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
        ...(patch.startedAt ? { startedAt: patch.startedAt } : {}),
        ...(patch.finishedAt ? { finishedAt: patch.finishedAt } : {}),
      },
    });
  }

  async isCancelled(runId: string): Promise<boolean> {
    const r = await this.prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
    return r?.status === 'CANCELLED';
  }

  async logStep(runId: string, e: StepLog): Promise<void> {
    await this.prisma.runLog.create({
      data: {
        runId,
        step: e.step,
        status: e.status,
        attempt: e.attempt ?? 1,
        durationMs: e.durationMs ?? null,
        tokensIn: e.tokensIn ?? null,
        tokensOut: e.tokensOut ?? null,
        modelId: e.modelId ?? null,
        errorCode: e.errorCode ?? null,
        errorMsg: e.errorMsg ?? null,
      },
    });
  }

  async saveAnalysis(jdId: string, a: AnalysisResult): Promise<void> {
    await this.prisma.jobDescription.update({
      where: { id: jdId },
      data: {
        status: 'ANALYZED',
        company: a.company,
        roleTitle: a.roleTitle,
        location: a.location || null,
        seniority: a.seniority || null,
        industryTags: a.industryTags,
        responsibilities: json(a.responsibilities),
        requirements: json(a.requirements),
        keywords: a.topKeywords,
        companyInferred: a.companyInferred,
        companyConfidence: a.companyConfidence,
      },
    });
  }

  async saveOutput(runId: string, output: unknown): Promise<void> {
    await this.prisma.run.update({ where: { id: runId }, data: { outputJson: json(output) } });
  }

  async replaceFlags(runId: string, flags: ValidationFlag[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.validationFlag.deleteMany({ where: { runId } }),
      this.prisma.validationFlag.createMany({
        data: flags.map((f) => ({
          runId,
          // The schema has no ruleId column, so the rule id prefixes the code.
          code: `${f.ruleId}:${f.code}`,
          severity: f.severity,
          field: f.path ?? null,
          message: f.message,
        })),
      }),
    ]);
  }

  async saveCompletion(runId: string, rec: CompletionRecord): Promise<void> {
    const targets = rec.outputJson.targetCompanies;
    await this.prisma.$transaction([
      this.prisma.run.updateMany({
        where: { id: runId, NOT: { status: 'CANCELLED' } },
        data: {
          status: rec.status,
          stage: rec.status === 'COMPLETE' ? 'complete' : 'needs review',
          progress: rec.status === 'COMPLETE' ? 1 : undefined,
          errorCode: rec.errorCode ?? null,
          outputJson: json(rec.outputJson),
          validation: json(rec.validation),
          docxKey: rec.docxKey,
          pdfKey: rec.pdfKey,
          pageCount: rec.pageCount,
          keywordCount: rec.keywordCount,
          actualTokens: rec.actualTokens,
          finishedAt: new Date(),
        },
      }),
      this.prisma.keywordSet.upsert({
        where: { runId },
        create: {
          runId, jdTerms: rec.jdTerms, relatedTerms: rec.relatedTerms,
          totalDistinct: rec.keywordCount,
        },
        update: {
          jdTerms: rec.jdTerms, relatedTerms: rec.relatedTerms, totalDistinct: rec.keywordCount,
        },
      }),
      this.prisma.alignedCompany.deleteMany({ where: { runId } }),
      this.prisma.alignedCompany.createMany({
        data: targets.map((t, i) => ({
          runId, rank: i + 1, name: t.name, department: t.department, exampleRole: t.exampleRole,
        })),
      }),
      ...(rec.docxKey
        ? [this.prisma.document.upsert({
            where: { runId },
            create: { runId, docxKey: rec.docxKey, pdfKey: rec.pdfKey, sizeBytes: rec.docxSize },
            update: { docxKey: rec.docxKey, pdfKey: rec.pdfKey, sizeBytes: rec.docxSize },
          })]
        : []),
    ]);
  }
}
