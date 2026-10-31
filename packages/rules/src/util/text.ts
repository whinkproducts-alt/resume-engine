// packages/rules/src/util/text.ts
// Tokenising, verb extraction, numeric-token scanning and prose helpers.

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
 * Overlap coefficient (intersection / smaller-set-size) over tokens with stop
 * words removed. Chosen over Jaccard so that "Data Scientist" against
 * "Lead Data Scientist" scores 1.0, which is the intent of the 70%
 * close-variant rule ("ignoring stop words like Senior, Lead").
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

/** Jaccard similarity of two token sets (used by R19 near-duplicate check). */
export function jaccard(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Lower-cases, strips punctuation, collapses whitespace. */
export function normalizeText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapses case and whitespace only (for comparing names and labels). */
export function looseEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return n(a) === n(b);
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
  const raw = tokenize(bullet)[0];
  if (!raw) return null;
  const irregular = IRREGULAR_PAST[raw];
  if (irregular) return irregular;
  if (raw.length > 4 && raw.endsWith('ing')) return raw.slice(0, -3);
  if (raw.length > 3 && raw.endsWith('ed')) return raw.slice(0, -2);
  if (raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss')) {
    return raw.slice(0, -1);
  }
  return raw;
}

/* ------------------------------ numeric scanning ---------------------------- */

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
    const digits = (m[1] ?? '').replace(/,/g, '');
    const numeric = Number(digits);
    if (Number.isFinite(numeric)) {
      let unit: string | null = m[2] ? m[2].toLowerCase() : null;
      if (unit) {
        unit = unit.replace(/[.,;:]$/, '');
        unit = UNIT_ALIASES[unit] ?? unit;
      }
      out.push({ raw: m[0].trim(), numeric, unit, index: m.index });
    }
    if (m.index === NUMERIC_RE.lastIndex) NUMERIC_RE.lastIndex++; // guard
  }
  return out;
}

/** Expands 'k' / 'm' / 'bn' suffixes into a canonical magnitude. */
export function canonicalMagnitude(t: NumericToken): number {
  switch (t.unit) {
    case 'k': return t.numeric * 1_000;
    case 'm': case 'mm': return t.numeric * 1_000_000;
    case 'bn': case 'b': return t.numeric * 1_000_000_000;
    default: return t.numeric;
  }
}

/** True for a bare four-digit year with no unit (a date mention, not a metric). */
export function isBareYear(t: NumericToken): boolean {
  return t.unit == null && /^\d{4}$/.test(t.raw) && t.numeric >= 1950 && t.numeric <= 2100;
}

/* --------------------------------- prose ------------------------------------ */

export function wordCount(text: string): number {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

export function splitSentences(text: string): string[] {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}
