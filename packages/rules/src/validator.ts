// packages/rules/src/validator.ts
// Deterministic rule executor. Runs R1..R20, partitions flags, decides retry.

import {
  Rule,
  RuleConfig,
  RuleContext,
  RuleOutcome,
  ValidationFlag,
  ValidationResult,
} from './types';
import { DEFAULT_RULE_CONFIG } from './types';
import { ALL_RULES } from './rules';

export class RuleValidator {
  private readonly rules: Rule[];

  constructor(
    private readonly config: RuleConfig = DEFAULT_RULE_CONFIG,
    rules: Rule[] = ALL_RULES,
  ) {
    this.rules = [...rules];
  }

  register(rule: Rule): this {
    this.rules.push(rule);
    return this;
  }

  /** Replaces a rule by id — used for tenant-specific overrides. */
  override(rule: Rule): this {
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) this.rules[idx] = rule;
    else this.rules.push(rule);
    return this;
  }

  async validate(ctx: Omit<RuleContext, 'config'>): Promise<ValidationResult> {
    const fullCtx: RuleContext = {
      ...ctx,
      config: this.config,
      targetRole: ctx.targetRole || ctx.resume.meta.targetRole || '',
      fileName: ctx.fileName || ctx.resume.meta.fileName || '',
      attempt: ctx.attempt ?? 1,
    };

    const flags: ValidationFlag[] = [];
    const ruleResults: RuleOutcome[] = [];

    for (const rule of this.rules) {
      const started = Date.now();
      try {
        const produced = await rule.evaluate(fullCtx);
        const normalised = (produced ?? []).map((f) => ({
          ...f,
          // Defensive: honour the rule-level blocking contract.
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
        // A crashed rule must never silently pass a run.
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

    return buildResult(fullCtx, flags, ruleResults, this.config);
  }
}

export function buildResult(
  ctx: RuleContext,
  flags: ValidationFlag[],
  ruleResults: RuleOutcome[],
  config: RuleConfig,
): ValidationResult {
  const blockingFailures = flags.filter((f) => f.blocking);
  const warnings = flags.filter((f) => !f.blocking && f.severity === 'warn');
  const infos = flags.filter((f) => f.severity === 'info');
  const attempt = ctx.attempt ?? 1;

  return {
    runId: ctx.resume.meta.runId,
    attempt,
    passed: blockingFailures.length === 0,
    requiresRetry:
      blockingFailures.length > 0 && attempt <= config.maxRetries,
    blockingFailures,
    warnings,
    infos,
    flags,
    ruleResults,
    evaluatedAt: new Date().toISOString(),
  };
}
