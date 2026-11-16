// packages/rules/src/retry.ts
// Blocking failures trigger a regeneration. Budget: max 2 retries (3 attempts).

import type {
  RegenerateFn,
  RuleConfig,
  RuleContext,
  ValidationFlag,
  ValidationResult,
} from './types';
import { DEFAULT_RULE_CONFIG } from './types';
import { validateRules } from './validator';

export async function runWithRetry(
  initialResume: RuleContext['resume'],
  base: RuleContext['base'],
  jd: RuleContext['jd'],
  toggles: RuleContext['toggles'],
  factBank: RuleContext['factBank'],
  fileName: string,
  regenerate: RegenerateFn,
  config: RuleConfig = DEFAULT_RULE_CONFIG,
  llmJudgement?: RuleContext['llmJudgement'],
  contactLocationOverride?: string | null,
  onAttempt?: (attempt: number, result: ValidationResult) => void | Promise<void>,
): Promise<{
  resume: RuleContext['resume'];
  result: ValidationResult;
  attempts: number;
  exhausted: boolean;
  requiresHumanReview: boolean;
}> {
  const maxAttempts = config.maxRetries + 1;
  let resume = initialResume;
  let result!: ValidationResult;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result = await validateRules(
      {
        resume,
        base,
        jd,
        toggles,
        factBank,
        fileName,
        contactLocationOverride: contactLocationOverride ?? null,
        ...(llmJudgement ? { llmJudgement } : {}),
        attempt,
      },
      config,
    );

    await onAttempt?.(attempt, result);

    if (result.blockingFailures.length === 0) {
      return { resume, result, attempts: attempt, exhausted: false, requiresHumanReview: false };
    }
    if (attempt === maxAttempts) break;

    resume = await regenerate(attempt, result.blockingFailures);
  }

  return { resume, result, attempts: maxAttempts, exhausted: true, requiresHumanReview: true };
}

export function toRetryFeedback(flags: ValidationFlag[]): string {
  return flags
    .map((f) => `[${f.ruleId}/${f.code}] ${f.message}${f.path ? ` @ ${f.path}` : ''}`)
    .join('\n');
}
