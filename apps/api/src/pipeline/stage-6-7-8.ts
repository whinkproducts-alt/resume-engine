// apps/api/src/pipeline/stage-6-7-8.ts
// Wires Stage 6 (validate) -> Stage 7 (render DOCX) -> Stage 8 (PDF + QA + upload).
// See 01-SPEC-v3.md section 5.

import {
  DEFAULT_RULE_CONFIG,
  RuleValidator,
  runWithRetry,
  type BaseSnapshot,
  type FactBankEntry,
  type JdContext,
  type LlmJudgement,
  type RegenerateFn,
  type ResumeDoc,
  type RuleConfig,
  type RuleToggles,
  type ValidationFlag,
  type ValidationResult,
} from '@resume-engine/rules';
import { renderResumeDocx, type BrandingOptions } from '@resume-engine/renderer';
import { runPdfQa } from '@resume-engine/qa';
import { artifactKeys, slugifyFileName, type ArtifactRef } from '@resume-engine/storage';

/** The part of ArtifactStore this pipeline needs (so tests can fake it). */
export interface ArtifactSink {
  put(
    key: string,
    body: Buffer,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<ArtifactRef>;
}

export interface PipelineDeps {
  validator?: RuleValidator;
  config?: RuleConfig;
  store: ArtifactSink;
  regenerate: RegenerateFn;
  onValidation?: (runId: string, result: ValidationResult) => Promise<void>;
  onArtifacts?: (runId: string, artifacts: {
    docxKey: string; pdfKey: string; pageCount: number;
    docxSize: number; pdfSize: number;
  }) => Promise<void>;
  /** Called as the run moves into Stage 7 and Stage 8, so the caller can update Run.status. */
  onStage?: (stage: 'RENDERING' | 'EXPORTING_PDF') => Promise<void>;
  /** Overrides the LibreOffice binary path (defaults to SOFFICE_PATH / PATH lookup). */
  sofficePath?: string;
}

export interface Stage6to8Input {
  runId: string;
  resume: ResumeDoc;
  base: BaseSnapshot;
  jd: JdContext;
  toggles: RuleToggles;
  factBank: FactBankEntry[];
  fileName: string;
  contactLocationOverride?: string | null;
  llmJudgement?: LlmJudgement;
  /** Provided only when the run owner is on the AGENCY plan. */
  branding?: BrandingOptions | null;
}

export interface Stage6to8Output {
  validation: ValidationResult;
  attempts: number;
  /** True when blocking failures survived the retry budget; nothing was rendered. */
  requiresHumanReview: boolean;
  /** The resume that was validated (and rendered, when review is not required). */
  resume: ResumeDoc;
  docxKey: string | null;
  pdfKey: string | null;
  docxSize: number | null;
  pdfSize: number | null;
  pageCount: number | null;
  /** Stage 8 QA findings, such as PAGE_OVERFLOW. Always non-blocking. */
  qaFlags: ValidationFlag[];
}

export async function runStages6to8(
  input: Stage6to8Input,
  deps: PipelineDeps,
): Promise<Stage6to8Output> {
  const config = deps.config ?? DEFAULT_RULE_CONFIG;
  const validator = deps.validator ?? new RuleValidator(config);

  /* ------------------------------ Stage 6 ------------------------------- */

  const retry = await runWithRetry({
    validator,
    initialResume: input.resume,
    base: input.base,
    jd: input.jd,
    toggles: input.toggles,
    factBank: input.factBank,
    fileName: input.fileName,
    contactLocationOverride: input.contactLocationOverride ?? null,
    ...(input.llmJudgement ? { llmJudgement: input.llmJudgement } : {}),
    regenerate: deps.regenerate,
    config,
    onAttempt: async (_attempt, result) => {
      await deps.onValidation?.(input.runId, result);
    },
  });

  if (retry.exhausted) {
    // Blocking failures survived the retry budget: do not ship an ungrounded file.
    return {
      validation: retry.result,
      attempts: retry.attempts,
      requiresHumanReview: true,
      resume: retry.resume,
      docxKey: null,
      pdfKey: null,
      docxSize: null,
      pdfSize: null,
      pageCount: null,
      qaFlags: [],
    };
  }

  /* ------------------------------ Stage 7 ------------------------------- */

  const resume = retry.resume;
  await deps.onStage?.('RENDERING');
  const { buffer: docx } = await renderResumeDocx(resume, { branding: input.branding ?? null });

  /* ------------------------------ Stage 8 ------------------------------- */

  await deps.onStage?.('EXPORTING_PDF');
  const qa = await runPdfQa(docx, {
    maxPages: config.maxPages,
    runId: input.runId,
    ...(deps.sofficePath ? { sofficePath: deps.sofficePath } : {}),
  });

  const keys = artifactKeys(input.runId, slugifyFileName(input.fileName));

  const [docxRef, pdfRef] = await Promise.all([
    deps.store.put(keys.docx, docx,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      { runId: input.runId, attempt: String(retry.attempts) }),
    deps.store.put(keys.pdf, qa.pdf, 'application/pdf',
      { runId: input.runId, pages: String(qa.pageCount) }),
  ]);

  await deps.store.put(
    keys.validation,
    Buffer.from(JSON.stringify({
      validation: retry.result,
      qaFlags: qa.flags,
      pageCount: qa.pageCount,
      overflow: qa.overflow,
    }, null, 2)),
    'application/json',
  );

  await deps.onArtifacts?.(input.runId, {
    docxKey: docxRef.key,
    pdfKey: pdfRef.key,
    pageCount: qa.pageCount,
    docxSize: docxRef.size,
    pdfSize: pdfRef.size,
  });

  return {
    validation: retry.result,
    attempts: retry.attempts,
    requiresHumanReview: false,
    resume,
    docxKey: docxRef.key,
    pdfKey: pdfRef.key,
    docxSize: docxRef.size,
    pdfSize: pdfRef.size,
    pageCount: qa.pageCount,
    qaFlags: qa.flags,
  };
}
