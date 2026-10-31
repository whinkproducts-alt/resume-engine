// packages/rules/src/util/date.ts
// Lenient month-precision date parsing shared by R4, R5, R6, R17.

export interface YearMonth {
  y: number;
  m: number; // 1..12
}

const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_ONLY = /^(\d{4})$/;
const PRESENT = /^(present|current|now|ongoing)$/i;

/**
 * Parses 'YYYY-MM', 'YYYY-MM-DD', 'YYYY', 'Present', 'Current'.
 * Returns null when the value cannot be interpreted.
 */
export function parseYearMonth(raw: string | null | undefined): YearMonth | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (PRESENT.test(s)) return null; // caller treats as "open ended"

  let m = ISO_MONTH.exec(s);
  if (m) return normalise(Number(m[1]), Number(m[2]));

  m = ISO_DAY.exec(s);
  if (m) return normalise(Number(m[1]), Number(m[2]));

  m = YEAR_ONLY.exec(s);
  if (m) return normalise(Number(m[1]), 1);

  // 'Jan 2021' / 'January 2021' / '2021-1'
  const loose = /^([A-Za-z]{3,9})[\s,/-]+(\d{4})$/.exec(s);
  if (loose) {
    const monthIdx = MONTH_NAMES.indexOf(loose[1].slice(0, 3).toLowerCase());
    if (monthIdx >= 0) return normalise(Number(loose[2]), monthIdx + 1);
  }
  const reversed = /^(\d{4})[\s,/-]+([A-Za-z]{3,9})$/.exec(s);
  if (reversed) {
    const monthIdx = MONTH_NAMES.indexOf(reversed[2].slice(0, 3).toLowerCase());
    if (monthIdx >= 0) return normalise(Number(reversed[1]), monthIdx + 1);
  }
  const shortMonth = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (shortMonth) return normalise(Number(shortMonth[1]), Number(shortMonth[2]));

  return null;
}

const MONTH_NAMES = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

function normalise(y: number, m: number): YearMonth | null {
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  if (y < 1950 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  return { y, m };
}

export function toMonths(vm: YearMonth): number {
  return vm.y * 12 + (vm.m - 1);
}

export function monthsBetween(a: YearMonth, b: YearMonth): number {
  return toMonths(b) - toMonths(a);
}

export function isPresent(raw: string | null | undefined): boolean {
  return raw != null && PRESENT.test(String(raw).trim());
}

export function isCanonicalIsoMonth(raw: string | null | undefined): boolean {
  return raw != null && ISO_MONTH.test(String(raw).trim());
}

export function formatYearMonth(vm: YearMonth): string {
  const mm = String(vm.m).padStart(2, '0');
  return `${vm.y}-${mm}`;
}
