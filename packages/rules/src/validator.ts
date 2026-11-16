// packages/rules/src/validator.ts
// Deterministic rule executor. Runs R1..R20 and FACTS, partitions flags, decides retry.

import {
  Rule,
  RuleConfig,
  RuleContext,
  RuleOutcome,
  ValidationFlag,
  ValidationResult,
  DEFAULT_RULE_CONFIG,
} from './types';
import { ALL_RULES } from './rules';

export async function validateRules(
  ctx: Omit<RuleContext, 'config'>,
  config: RuleConfig = DEFAULT_RULE_CONFIG,
  rules: Rule[] = ALL_RULES,
): Promise<ValidationResult> {
  const fullCtx: RuleContext = {
    ...ctx,
    config,
    fileName: ctx.fileName || ctx.resume.meta.fileName || '',
    attempt: ctx.attempt ?? 1,
  };

  const flags: ValidationFlag[] = [];
  const ruleResults: RuleOutcome[] = [];

  for (const rule of rules) {
    const started = Date.now();
    try {
      const produced = await rule.evaluate(fullCtx);
      const normalised = (produced ?? []).map((f) => ({
        ...f,
        blocking: rule.blocking ? f.blocking : false,
        severity: f.severity,
      }));
      flags.push(...normalised);
      ruleResults.push({
        ruleId: rule.id,
        name: rule.name,
        passed: normalised.filter((f) => f.blocking).length === 0,
        flagCount: normalised.length,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      flags.push({
        ruleId: rule.id,
        code: 'RULE_EXECUTION_ERROR',
        severity: 'error',
        blocking: true,
        message: `Rule ${rule.id} threw: ${message}`,
      });
      ruleResults.push({
        ruleId: rule.id,
        name: rule.name,
        passed: false,
        flagCount: 1,
        durationMs: Date.now() - started,
        error: message,
      });
    }
  }

  const blockingFailures = flags.filter((f) => f.blocking);
  const warnings = flags.filter((f) => !f.blocking && f.severity === 'warn');
  const infos = flags.filter((f) => f.severity === 'info');
  const attempt = fullCtx.attempt ?? 1;

  return {
    runId: fullCtx.resume.meta.runId,
    attempt,
    passed: blockingFailures.length === 0,
    requiresRetry: blockingFailures.length > 0 && attempt <= config.maxRetries,
    blockingFailures,
    warnings,
    infos,
    flags,
    ruleResults,
    evaluatedAt: new Date().toISOString(),
  };
}
