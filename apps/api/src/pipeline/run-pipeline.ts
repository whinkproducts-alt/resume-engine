// apps/api/src/pipeline/run-pipeline.ts
// The 8 stage pipeline orchestrator (01-SPEC-v3.md section 5).
//
//   0 quota gate ........ enforced when the run is created (RunsService)
//   1 ingest ............ guard on the stored JD text (extraction happens in POST /jds)
//   2 analyze ............ LLM, strict JSON schema, stored on JobDescription
//   3 confirm ............ pause at AWAITING_COMPANY_CONFIRM, resume at stage 4
//   4 rewrite ............ one LLM call per section
//   5 assemble ........... header, roster, education copied from the database
//   6 validate ........... R1..R20 + FACTS, section level retry (max 2)
//   7 render, 8 export ... DOCX, LibreOffice PDF, page QA, upload

import { z } from 'zod';
import {
  DEFAULT_RULE_CONFIG,
  type BaseSnapshot,
  type ResumeDoc,
  type RuleConfig,
  type ValidationFlag,
} from '@resume-engine/rules';
import type { LlmClient } from './llm';
import { ANALYZE_SCHEMA, ANALYZE_SYSTEM, analyzeUser } from './prompts';
import { SectionGenerator, assemble, sectionsFromResume, type Sections } from './sections';
import { runStages6to8, type ArtifactSink } from './stage-6-7-8';
import type {
  AnalysisResult, JdRecord, PipelineModels, PipelineRepo, RunContext, RunJobData,
} from './types';

export const MIN_JD_CHARS = 200;
export const COMPANY_CONFIDENCE_THRESHOLD = 0.75;

export type PipelineOutcome = 'COMPLETE' | 'AWAITING_COMPANY_CONFIRM' | 'FAILED' | 'CANCELLED';

export interface PipelineEnv {
  repo: PipelineRepo;
  llm: LlmClient;
  models: PipelineModels;
  store: ArtifactSink;
  config?: RuleConfig;
  sofficePath?: string;
  now?: () => Date;
}

/** A failure with a stable error code that ends the run (no retry). */
export class PipelineError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'PipelineError';
  }
}

const zAnalysis = z.object({
  company: z.string(),
  roleTitle: z.string(),
  location: z.string(),
  seniority: z.string(),
  industryTags: z.array(z.string()),
  topKeywords: z.array(z.string()),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  companyInferred: z.boolean(),
  companyConfidence: z.number().min(0).max(1),
});

export function needsCompanyConfirmation(a: Pick<AnalysisResult, 'companyInferred' | 'companyConfidence'>): boolean {
  return a.companyInferred || a.companyConfidence < COMPANY_CONFIDENCE_THRESHOLD;
}

function applyAnalysis(jd: JdRecord, a: AnalysisResult): JdRecord {
  return {
    ...jd,
    company: a.company,
    roleTitle: a.roleTitle,
    location: a.location || null,
    seniority: a.seniority || null,
    industryTags: a.industryTags,
    responsibilities: a.responsibilities,
    requirements: a.requirements,
    keywords: a.topKeywords,
    companyInferred: a.companyInferred,
    companyConfidence: a.companyConfidence,
  };
}

export function baseSnapshotOf(ctx: RunContext): BaseSnapshot {
  const p = ctx.profile;
  return {
    header: {
      fullName: p.fullName, city: p.city, phones: p.phones, email: p.email, linkedIn: p.linkedIn,
    },
    roles: p.roles.map((r) => ({
      company: r.company,
      baseTitle: r.baseTitle,
      startDate: r.startDate,
      endDate: r.endDate,
      location: r.location,
      flagship: r.baseFlagship,
      bullets: r.baseBullets,
    })),
    education: p.education,
    certifications: p.certifications,
    keywords: ctx.base.keywords,
  };
}

export async function runPipeline(env: PipelineEnv, job: RunJobData): Promise<PipelineOutcome> {
  const { repo } = env;
  const now = env.now ?? (() => new Date());
  const { runId } = job;

  const loaded = await repo.loadContext(runId);
  if (!loaded) throw new PipelineError('RUN_NOT_FOUND', `Run ${runId} does not exist`);
  if (loaded.run.status === 'CANCELLED') return 'CANCELLED';
  if (loaded.run.status === 'COMPLETE') return 'COMPLETE';

  let tokens = 0;

  const fail = async (code: string, message: string): Promise<PipelineOutcome> => {
    await repo.logStep(runId, { step: 'pipeline', status: 'error', errorCode: code, errorMsg: message });
    await repo.setStatus(runId, 'FAILED', { errorCode: code, finishedAt: now() });
    return 'FAILED';
  };
  const cancelled = () => repo.isCancelled(runId);

  try {
    /* ------------------------------ Stage 1 ------------------------------ */
    await repo.setStatus(runId, 'READING_JD', {
      stage: 'ingest', progress: 0.02, errorCode: null, startedAt: loaded.run.startedAt ?? now(),
    });
    if (loaded.jd.rawText.trim().length < MIN_JD_CHARS) {
      return await fail('JD_UNUSABLE', `Job description has fewer than ${MIN_JD_CHARS} characters.`);
    }
    if (loaded.profile.roles.length === 0) {
      return await fail('PROFILE_ROSTER_MISSING',
        'The profile has no roles. Add the employment roster before running (PUT /v1/profiles/:id/roles).');
    }
    await repo.logStep(runId, { step: 'ingest', status: 'ok' });

    /* ------------------------------ Stage 2 ------------------------------ */
    let ctx = loaded;
    if (job.resumeFrom !== 'rewrite') {
      await repo.setStatus(runId, 'ANALYZING', { stage: 'analyze', progress: 0.05 });
      const t0 = Date.now();
      const res = await env.llm.completeJson({
        model: env.models.analyze,
        system: ANALYZE_SYSTEM,
        user: analyzeUser(loaded.jd.rawText),
        schema: ANALYZE_SCHEMA,
        temperature: 0.1,
      });
      tokens += res.tokensIn + res.tokensOut;
      const analysis = zAnalysis.parse(res.data);
      await repo.saveAnalysis(loaded.jd.id, analysis);
      await repo.logStep(runId, {
        step: 'analyze', status: 'ok', durationMs: Date.now() - t0,
        tokensIn: res.tokensIn, tokensOut: res.tokensOut, modelId: res.model,
      });
      ctx = { ...loaded, jd: applyAnalysis(loaded.jd, analysis) };

      /* ---------------------------- Stage 3 ------------------------------ */
      if (needsCompanyConfirmation(analysis) && !loaded.run.companyConfirmed) {
        await repo.setStatus(runId, 'AWAITING_COMPANY_CONFIRM', { stage: 'confirm', progress: 0.08 });
        await repo.logStep(runId, { step: 'confirm', status: 'ok' });
        return 'AWAITING_COMPANY_CONFIRM';
      }
    }

    const company = (ctx.jd.company ?? '').trim();
    if (!company) return await fail('COMPANY_MISSING', 'No company name is available for this run.');
    if (await cancelled()) return 'CANCELLED';

    /* ------------------------------ Stage 4 ------------------------------ */
    await repo.setStatus(runId, 'REWRITING', { stage: 'rewrite', progress: 0.10 });
    const gen = new SectionGenerator({ llm: env.llm, models: env.models, repo }, ctx, company);
    let sections: Sections = await gen.generateAll(async (progress, stage) => {
      await repo.setStatus(runId, 'REWRITING', { stage: `rewrite: ${stage}`, progress });
    });
    await repo.saveOutput(runId, { stage: 'rewritten', sections });
    if (await cancelled()) return 'CANCELLED';

    /* ------------------------------ Stage 5 ------------------------------ */
    let resume: ResumeDoc = assemble(ctx, sections, company, now());

    /* --------------------------- Stages 6, 7, 8 --------------------------- */
    await repo.setStatus(runId, 'VALIDATING', { stage: 'validate', progress: 0.96 });
    const out = await runStages6to8(
      {
        runId,
        resume,
        base: baseSnapshotOf(ctx),
        jd: { roleTitle: ctx.jd.roleTitle ?? '', keywords: ctx.jd.keywords },
        toggles: ctx.snapshot.toggles,
        factBank: ctx.profile.facts,
        fileName: resume.meta.fileName,
        contactLocationOverride: ctx.run.contactLocationOverride,
        branding: ctx.branding,
      },
      {
        store: env.store,
        config: env.config ?? DEFAULT_RULE_CONFIG,
        ...(env.sofficePath ? { sofficePath: env.sofficePath } : {}),
        regenerate: async (attempt, flags) => {
          sections = await gen.regenerate(sections, flags, attempt);
          resume = assemble(ctx, sections, company, now());
          return resume;
        },
        onValidation: async (_id, result) => {
          await repo.replaceFlags(runId, result.flags);
        },
        onStage: async (stage) => {
          await repo.setStatus(runId, stage, {
            stage: stage === 'RENDERING' ? 'render' : 'export',
            progress: stage === 'RENDERING' ? 0.98 : 0.99,
          });
        },
      },
    );

    const finalDoc = out.resume;
    const jdTerms = ctx.jd.keywords;
    const jdSet = new Set(jdTerms.map((k) => k.toLowerCase()));
    const distinct = [...new Set(finalDoc.keywords.map((k) => k.toLowerCase()))];
    const allFlags: ValidationFlag[] = [...out.validation.flags, ...out.qaFlags];
    await repo.replaceFlags(runId, allFlags);

    await repo.saveCompletion(runId, {
      status: out.requiresHumanReview ? 'FAILED' : 'COMPLETE',
      ...(out.requiresHumanReview ? { errorCode: 'VALIDATION_FAILED' } : {}),
      outputJson: finalDoc,
      validation: out.validation,
      qaFlags: out.qaFlags,
      docxKey: out.docxKey,
      pdfKey: out.pdfKey,
      docxSize: out.docxSize,
      pdfSize: out.pdfSize,
      pageCount: out.pageCount,
      keywordCount: distinct.length,
      actualTokens: tokens + gen.tokens,
      jdTerms,
      relatedTerms: finalDoc.keywords.filter((k) => !jdSet.has(k.toLowerCase())),
    });
    await repo.logStep(runId, {
      step: 'pipeline',
      status: out.requiresHumanReview ? 'error' : 'ok',
      ...(out.requiresHumanReview ? { errorCode: 'VALIDATION_FAILED' } : {}),
    });
    return out.requiresHumanReview ? 'FAILED' : 'COMPLETE';
  } catch (err) {
    if (err instanceof PipelineError) return fail(err.code, err.message);
    await repo.logStep(runId, {
      step: 'pipeline', status: 'error', errorCode: 'PIPELINE_ERROR',
      errorMsg: err instanceof Error ? err.message.slice(0, 500) : String(err),
    });
    throw err; // transient: BullMQ retries; the worker marks the run FAILED on the last attempt
  }
}

export { sectionsFromResume };
