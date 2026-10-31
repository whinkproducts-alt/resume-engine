// apps/api/src/pipeline/stage-6-7-8.ts
// Wires Stage 6 (validate) -> Stage 7 (render DOCX) -> Stage 8 (PDF + QA + upload).

import {
  RuleValidator,
  RuleConfig,
  DEFAULT_RULE_CONFIG,
  ResumeDoc,
  FactBankEntry,
  ValidationResult,
  RegenerateFn,
  runWithRetry,
  LlmJudgement,
} from '@resume-engine/rules';
import { renderResumeDocx } from '@resume-engine/renderer';
import { runPdfQa } from '@resume-engine/qa';
import { ArtifactStore, artifactKeys, slugifyFileName } from '@resume-engine/storage';

export interface PipelineDeps {
  validator?: RuleValidator;
  config?: RuleConfig;
  store: ArtifactStore;
  regenerate: RegenerateFn;
  onValidation?: (runId: string, result: ValidationResult) => Promise<void>;
  onArtifacts?: (runId: string, artifacts: {
    docxKey: string; pdfKey: string; pageCount: number;
    docxSize: number; pdfSize: number;
  }) => Promise<void>;
}

export interface Stage6to8Input {
  runId: string;
  resume: ResumeDoc;
  factBank: FactBankEntry[];
  targetRole: string;
  fileName: string;
  llmJudgement?: LlmJudgement;
}

export interface Stage6to8Output {
  validation: ValidationResult;
  attempts: number;
  requiresHumanReview: boolean;
  docxKey: string | null;
  pdfKey: string | null;
  pageCount: number | null;
  postRenderValidation: ValidationResult;
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
    factBank: input.factBank,
    targetRole: input.targetRole,
    fileName: input.fileName,
    llmJudgement: input.llmJudgement,
    regenerate: deps.regenerate,
    config,
    onAttempt: async (_attempt, result) => {
      await deps.onValidation?.(input.runId, result);
    },
  });

  if (retry.exhausted) {
    // Blocking failures survived the retry budget — do not render.
    return {
      validation: retry.result,
      attempts: retry.attempts,
      requiresHumanReview: true,
      docxKey: null,
      pdfKey: null,
      pageCount: null,
      postRenderValidation: retry.result,
    };
  }

  /* ------------------------------ Stage 7 ------------------------------- */

  const resume = retry.resume;
  const { buffer: docx, nodes } = await renderResumeDocx(resume);

  /* ------------------------------ Stage 8 ------------------------------- */

  const qa = await runPdfQa(docx, {
    maxPages: config.maxPages,
    runId: input.runId,
  });

  // Post-render validation pass: R13 (node inventory) + R15 (page count).
  const postRenderValidation = await validator.validate({
    resume,
    factBank: input.factBank,
    targetRole: input.targetRole,
    fileName: input.fileName,
    llmJudgement: input.llmJudgement,
    pageCount: qa.pageCount,
    renderedNodes: nodes,
    attempt: retry.attempts,
  });

  /* ------------------------------ Upload -------------------------------- */

  const slug = slugifyFileName(input.fileName);
  const keys = artifactKeys(input.runId, slug);

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
      stage6: retry.result,
      stage8: postRenderValidation,
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
    docxKey: docxRef.key,
    pdfKey: pdfRef.key,
    pageCount: qa.pageCount,
    postRenderValidation,
  };
}
