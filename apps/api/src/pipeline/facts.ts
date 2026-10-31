// apps/api/src/pipeline/facts.ts
// Maps the database FactBankEntry (claimText, metricValue, metricUnit, ...) to
// the engine's FactBankEntry. The Prisma model stays the source of truth.

import type { FactBankEntry, FactKind } from '@resume-engine/rules';

export interface FactRow {
  id: string;
  kind: string;
  claimText: string;
  metricValue: string | null;
  metricUnit: string | null;
  context: string;
  employer: string | null;
  verified: boolean;
}

const KINDS: readonly FactKind[] = ['metric', 'date', 'employer', 'title', 'education', 'skill', 'other'];

const UNIT_ALIASES: Record<string, string> = { percent: '%', pct: '%', percentage: '%' };

function normaliseUnit(u: string | null | undefined): string | undefined {
  const k = (u ?? '').trim().toLowerCase();
  if (!k) return undefined;
  return UNIT_ALIASES[k] ?? k;
}

export function toEngineFact(row: FactRow): FactBankEntry {
  const kind = (KINDS as readonly string[]).includes(row.kind.toLowerCase())
    ? (row.kind.toLowerCase() as FactKind)
    : 'other';

  const entry: FactBankEntry = {
    id: row.id,
    kind,
    value: row.claimText,
    verified: row.verified,
  };

  const mv = (row.metricValue ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)$/.exec(mv);
  if (m && m[1] !== undefined) {
    entry.numeric = Number(m[1]);
    const unit = normaliseUnit(row.metricUnit) ?? normaliseUnit(m[2]);
    if (unit) entry.unit = unit;

    const raw = (row.metricValue ?? '').trim();
    const rawUnit = (row.metricUnit ?? '').trim();
    entry.aliases = [
      raw,
      ...(rawUnit ? [`${raw}${rawUnit}`, `${raw} ${rawUnit}`] : []),
      ...(m[2] ? [`${m[1]}${m[2]}`] : []),
    ].filter(Boolean);
  }
  return entry;
}

/** Plain list for the prompt. In strict mode only verified facts are offered. */
export function factsForPrompt(facts: FactBankEntry[], strict: boolean): string {
  return facts
    .filter((f) => !strict || f.verified)
    .map((f) => `- ${f.value}${f.verified ? '' : ' (unverified)'}`)
    .join('\n');
}

/** True when a metric's value can be matched against numbers in the résumé ("40", "1.2", "$2M"). */
export function isParsableMetric(value: string | null | undefined): boolean {
  const mv = (value ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  return /^\d+(?:\.\d+)?\s*(?:[a-zA-Z]+|%)?$/.test(mv);
}
