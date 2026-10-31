// packages/rules/src/util/date.ts
// Lenient month-precision date parsing shared by R7 and R13.

export interface YearMonth {
  y: number;
  m: number; // 1..12
}

const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_ONLY = /^(\d{4})$/;
const SHORT_MONTH = /^(\d{4})-(\d{1,2})$/;
const NAME_YEAR = /^([A-Za-z]{3,9})[\s,/-]+(\d{4})$/;
const YEAR_NAME = /^(\d{4})[\s,/-]+([A-Za-z]{3,9})$/;
const PRESENT = /^(present|current|now|ongoing)$/i;

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

function monthIndex(name: string | undefined): number {
  return name ? MONTH_NAMES.indexOf(name.slice(0, 3).toLowerCase()) : -1;
}

/**
 * Parses 'YYYY-MM', 'YYYY-MM-DD', 'YYYY', 'Jan 2021', '2021 January'.
 * Returns null when the value cannot be interpreted or is open ended.
 */
export function parseYearMonth(raw: string | null | undefined): YearMonth | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || PRESENT.test(s)) return null;

  let m = ISO_MONTH.exec(s) ?? ISO_DAY.exec(s);
  if (m) return normalise(Number(m[1]), Number(m[2]));

  m = YEAR_ONLY.exec(s);
  if (m) return normalise(Number(m[1]), 1);

  m = SHORT_MONTH.exec(s);
  if (m) return normalise(Number(m[1]), Number(m[2]));

  m = NAME_YEAR.exec(s);
  if (m) {
    const idx = monthIndex(m[1]);
    if (idx >= 0) return normalise(Number(m[2]), idx + 1);
  }
  m = YEAR_NAME.exec(s);
  if (m) {
    const idx = monthIndex(m[2]);
    if (idx >= 0) return normalise(Number(m[1]), idx + 1);
  }
  return null;
}

export function isPresent(raw: string | null | undefined): boolean {
  return raw != null && PRESENT.test(String(raw).trim());
}

export function formatYearMonth(vm: YearMonth): string {
  return `${vm.y}-${String(vm.m).padStart(2, '0')}`;
}

/**
 * Canonical comparison key for a role date. Open-ended values (null,
 * undefined, 'Present') all map to 'present'; unparseable values fall back to
 * their trimmed text so that a change is still detected.
 */
export function dateKey(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === '' || isPresent(raw)) return 'present';
  const vm = parseYearMonth(raw);
  return vm ? formatYearMonth(vm) : String(raw).trim().toLowerCase();
}
