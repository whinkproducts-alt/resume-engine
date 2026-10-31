// packages/rules/src/util/text.ts
// Tokenising, verb extraction, and numeric-token scanning.

/* ------------------------------ R2 tokenising ------------------------------ */

export function tokenize(input: string): string[] {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s+#.]/g, ' ')
    .replace(/\./g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Overlap coefficient (intersection / smaller-set-size).
 * Chosen over Jaccard so that "Data Scientist" vs "Lead Data Scientist"
 * scores 1.0 once stop words are removed, which is the intent of the
 * 70% close-variant rule.
 */
export function tokenOverlap(
  a: string,
  b: string,
  stopWords: readonly string[],
): { score: number; shared: string[]; onlyA: string[]; onlyB: string[] } {
  const stop = new Set(stopWords.map((w) => w.toLowerCase()));
  const setA = new Set(tokenize(a).filter((t) => !stop.has(t)));
  const setB = new Set(tokenize(b).filter((t) => !stop.has(t)));

  if (setA.size === 0 || setB.size === 0) {
    return { score: 0, shared: [], onlyA: [...setA], onlyB: [...setB] };
  }

  const shared = [...setA].filter((t) => setB.has(t));
  const denom = Math.min(setA.size, setB.size);
  return {
    score: shared.length / denom,
    shared,
    onlyA: [...setA].filter((t) => !setB.has(t)),
    onlyB: [...setB].filter((t) => !setA.has(t)),
  };
}

/* ---------------------------- R10 verb extraction --------------------------- */

const IRREGULAR_PAST: Record<string, string> = {
  led: 'lead', built: 'build', drove: 'drive', grew: 'grow',
  ran: 'run', wrote: 'write', made: 'make', began: 'begin',
  brought: 'bring', chose: 'choose', dealt: 'deal', did: 'do',
  found: 'find', gave: 'give', held: 'hold', kept: 'keep',
  knew: 'know', left: 'leave', lost: 'lose', meant: 'mean',
  met: 'meet', paid: 'pay', put: 'put', said: 'say', saw: 'see',
  sold: 'sell', sent: 'send', set: 'set', spent: 'spend',
  took: 'take', taught: 'teach', told: 'tell', thought: 'think',
  won: 'win', wore: 'wear', sped: 'speed', cut: 'cut',
};

/** First token of a bullet, lower-cased, de-punctuated, de-inflected. */
export function extractLeadingVerb(bullet: string): string | null {
  const tokens = tokenize(bullet);
  if (tokens.length === 0) return null;
  const raw = tokens[0];
  if (IRREGULAR_PAST[raw]) return IRREGULAR_PAST[raw];
  if (raw.length > 4 && raw.endsWith('ing')) return raw.slice(0, -3);
  if (raw.length > 3 && raw.endsWith('ed')) return raw.slice(0, -2);
  if (raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss')) {
    return raw.slice(0, -1);
  }
  return raw;
}

/* --------------------------- R20 numeric scanning --------------------------- */

export interface NumericToken {
  raw: string;
  numeric: number;
  unit: string | null;
  index: number;
}

const NUMERIC_RE =
  /(\d[\d,]*(?:\.\d+)?)\s*(%|percent|k\b|m\b|mm\b|bn\b|b\b|x\b|hrs?\b|hours?\b|days?\b|weeks?\b|months?\b|years?\b|yrs?\b|users?\b|customers?\b|clients?\b|people\b|engineers?\b|developers?\b|reps?\b|requests?\b|rps\b|qps\b|ms\b|tb\b|gb\b|mb\b|usd\b|\$)?/gi;

const UNIT_ALIASES: Record<string, string> = {
  percent: '%',
  hrs: 'hours', hr: 'hours',
  yrs: 'years', yr: 'years',
  rps: 'requests',
  usd: '$',
};

export function scanNumericTokens(text: string): NumericToken[] {
  const out: NumericToken[] = [];
  NUMERIC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMERIC_RE.exec(text)) !== null) {
    const digits = m[1].replace(/,/g, '');
    const numeric = Number(digits);
    if (!Number.isFinite(numeric)) continue;
    let unit = m[2] ? m[2].toLowerCase().replace(/\b\b/g, '') : null;
    if (unit) {
      unit = unit.replace(/[.,;:]$/, '');
      unit = UNIT_ALIASES[unit] ?? unit;
    }
    out.push({ raw: m[0].trim(), numeric, unit, index: m.index });
    if (m.index === NUMERIC_RE.lastIndex) NUMERIC_RE.lastIndex++; // guard
  }
  return out;
}

/** Expands 'k' / 'm' / 'bn' / '%' suffixes into a canonical magnitude. */
export function canonicalMagnitude(t: NumericToken): number {
  switch (t.unit) {
    case 'k': return t.numeric * 1_000;
    case 'm': case 'mm': return t.numeric * 1_000_000;
    case 'bn': case 'b': return t.numeric * 1_000_000_000;
    default: return t.numeric;
  }
}

export function wordCount(text: string): number {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

export function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}
