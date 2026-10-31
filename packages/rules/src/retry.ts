// packages/rules/src/retry.ts
// Blocking failures trigger a regeneration. Budget: max 2 retries (3 attempts).

import {
  RegenerateFn,
  RetryOutcome,
  RuleContext,
  RuleConfig,
  ValidationFlag,
  ValidationResult,
} from './types';
import { DEFAULT_RULE_CONFIG } from './types';
import { RuleValidator } from './validator';

export interface RunWithRetryOptions {
  validator: RuleValidator;
  initialResume: RuleContext['resume'];
  factBank: RuleContext['factBank'];
  targetRole: string;
  fileName: string;
  regenerate: RegenerateFn;
  config?: RuleConfig;
  llmJudgement?: RuleContext['llmJudgement'];
  /** Invoked after every attempt (attempt is 1-based). */
  onAttempt?: (attempt: number, result: ValidationResult) => void | Promise<void>;
  /** Extra context merged into every RuleContext (e.g. renderedNodes). */
  extra?: Partial<Omit<RuleContext, 'resume' | 'config' | 'attempt'>>;
}

export async function runWithRetry(opts: RunWithRetryOptions): Promise<RetryOutcome> {
  const config = opts.config ?? DEFAULT_RULE_CONFIG;
  const maxAttempts = config.maxRetries + 1; // 1 initial + 2 retries

  let resume = opts.initialResume;
  let result!: ValidationResult;
  let attempt = 1;

  for (; attempt <= maxAttempts; attempt++) {
    result = await opts.validator.validate({
      resume,
      factBank: opts.factBank,
      targetRole: opts.targetRole,
      fileName: opts.fileName,
      llmJudgement: opts.llmJudgement,
      attempt,
      ...opts.extra,
    } as RuleContext);

    await opts.onAttempt?.(attempt, result);

    if (result.blockingFailures.length === 0) {
      return {
        resume,
        result,
        attempts: attempt,
        exhausted: false,
        requiresHumanReview: result.warnings.length > 0 && false,
      };
    }

    if (attempt === maxAttempts) break;

    // Feed blocking failures back to the generator as structured feedback.
    resume = await opts.regenerate(attempt, result.blockingFailures);
  }

  return {
    resume,
    result,
    attempts: maxAttempts,
    exhausted: true,
    requiresHumanReview: true,
  };
}

/** Compact feedback payload handed to the LLM pipeline on retry. */
export function toRetryFeedback(flags: ValidationFlag[]): string {
  return flags
    .map((f) => `[${f.ruleId}/${f.code}] ${f.message}${f.path ? ` @ ${f.path}` : ''}`)
    .join('\n');
}
