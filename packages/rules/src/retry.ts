// packages/rules/src/retry.ts
// Blocking failures trigger a regeneration. Budget: max 2 retries (3 attempts).

import type {
  RegenerateFn,
  RetryOutcome,
  RuleConfig,
  RuleContext,
  ValidationFlag,
  ValidationResult,
} from './types';
import { DEFAULT_RULE_CONFIG } from './types';
import type { RuleValidator } from './validator';

export interface RunWithRetryOptions {
  validator: RuleValidator;
  initialResume: RuleContext['resume'];
  base: RuleContext['base'];
  jd: RuleContext['jd'];
  toggles: RuleContext['toggles'];
  factBank: RuleContext['factBank'];
  fileName: string;
  regenerate: RegenerateFn;
  config?: RuleConfig;
  llmJudgement?: RuleContext['llmJudgement'];
  contactLocationOverride?: string | null;
  /** Invoked after every attempt (attempt is 1-based). */
  onAttempt?: (attempt: number, result: ValidationResult) => void | Promise<void>;
}

export async function runWithRetry(opts: RunWithRetryOptions): Promise<RetryOutcome> {
  const config = opts.config ?? DEFAULT_RULE_CONFIG;
  const maxAttempts = config.maxRetries + 1; // 1 initial + maxRetries

  let resume = opts.initialResume;
  let result!: ValidationResult;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result = await opts.validator.validate({
      resume,
      base: opts.base,
      jd: opts.jd,
      toggles: opts.toggles,
      factBank: opts.factBank,
      fileName: opts.fileName,
      contactLocationOverride: opts.contactLocationOverride ?? null,
      ...(opts.llmJudgement ? { llmJudgement: opts.llmJudgement } : {}),
      attempt,
    });

    await opts.onAttempt?.(attempt, result);

    if (result.blockingFailures.length === 0) {
      return { resume, result, attempts: attempt, exhausted: false, requiresHumanReview: false };
    }
    if (attempt === maxAttempts) break;

    // Feed blocking failures back to the generator as structured feedback.
    resume = await opts.regenerate(attempt, result.blockingFailures);
  }

  return { resume, result, attempts: maxAttempts, exhausted: true, requiresHumanReview: true };
}

/** Compact feedback payload handed to the LLM pipeline on retry. */
export function toRetryFeedback(flags: ValidationFlag[]): string {
  return flags
    .map((f) => `[${f.ruleId}/${f.code}] ${f.message}${f.path ? ` @ ${f.path}` : ''}`)
    .join('\n');
}
