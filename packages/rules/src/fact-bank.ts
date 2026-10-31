// packages/rules/src/fact-bank.ts
// Fact Bank matching used by the FACTS check.

import type { FactBankEntry } from './types';
import { canonicalMagnitude, type NumericToken } from './util/text';

export interface FactMatch {
  token: NumericToken;
  entry: FactBankEntry | null;
  /** How the match was established. */
  via: 'numeric+unit' | 'numeric' | 'alias' | 'raw' | 'none';
  verified: boolean;
}

const UNIT_EQUIVALENTS: Record<string, string> = {
  '%': '%',
  percent: '%',
  k: 'k',
  m: 'm',
  mm: 'mm',
  bn: 'bn',
  b: 'b',
  x: 'x',
  hours: 'hours',
  days: 'days',
  weeks: 'weeks',
  months: 'months',
  years: 'years',
  users: 'users',
  customers: 'customers',
  clients: 'clients',
  people: 'people',
  engineers: 'engineers',
  developers: 'developers',
  reps: 'reps',
  requests: 'requests',
  ms: 'ms',
  tb: 'tb',
  gb: 'gb',
  mb: 'mb',
  '$': '$',
};

function unitKey(u: string | null | undefined): string | null {
  if (!u) return null;
  const k = u.toLowerCase();
  return UNIT_EQUIVALENTS[k] ?? k;
}

/**
 * Finds the Fact Bank entry that best substantiates a numeric token.
 * Precedence: numeric+unit exact -> numeric (unit-agnostic) -> alias -> raw.
 */
export function matchNumericToken(
  token: NumericToken,
  factBank: FactBankEntry[],
): FactMatch {
  const tokenUnit = unitKey(token.unit);
  const magnitude = canonicalMagnitude(token);

  // 1. numeric + unit
  for (const e of factBank) {
    if (e.kind !== 'metric') continue;
    if (e.numeric == null) continue;
    if (Math.abs(e.numeric - magnitude) > 1e-9) continue;
    if (unitKey(e.unit) === tokenUnit) {
      return { token, entry: e, via: 'numeric+unit', verified: e.verified };
    }
  }

  // 2. numeric only (unit-agnostic)
  for (const e of factBank) {
    if (e.kind !== 'metric') continue;
    if (e.numeric == null) continue;
    if (Math.abs(e.numeric - magnitude) <= 1e-9) {
      return { token, entry: e, via: 'numeric', verified: e.verified };
    }
  }

  // 3. exact surface-form or alias match (e.g. "2M" for 2,000,000, years in date facts).
  //    Exact only: substring matching would let "5" be grounded by "50%".
  const needle = token.raw.trim().toLowerCase();
  for (const e of factBank) {
    const surfaces = [e.value, ...(e.aliases ?? [])].map((s) => s.trim().toLowerCase());
    if (surfaces.includes(needle)) {
      return { token, entry: e, via: 'alias', verified: e.verified };
    }
  }

  // 4. raw value equality against any kind
  for (const e of factBank) {
    if (e.value.trim().toLowerCase() === needle) {
      return { token, entry: e, via: 'raw', verified: e.verified };
    }
  }

  return { token, entry: null, via: 'none', verified: false };
}
