/** Phones are typed as one comma separated field and sent as an array. */
export function parsePhones(text: string): string[] {
  return text.split(",").map((p) => p.trim()).filter(Boolean);
}

/** One bullet per line. */
export function parseLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** The roster API wants "YYYY-MM"; accepts an ISO date from the API too. */
export function toMonth(v: string | null | undefined): string {
  return v ? v.slice(0, 7) : "";
}

export function toIntOrNull(v: string): number | null {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (v: string) => MONTH.test(v);

/** Mirrors the API's rule for a metric's value: "40", "1.2", "2M", "$2M", "1,200", "12 users". */
export function metricLooksValid(value: string): boolean {
  const mv = value.trim().replace(/^\$/, "").replace(/,/g, "");
  return /^\d+(?:\.\d+)?\s*(?:[a-zA-Z]+|%)?$/.test(mv);
}
