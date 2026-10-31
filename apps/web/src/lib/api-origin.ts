/**
 * Where /v1 is forwarded. Read at request time (middleware), not at build time, so one
 * image works in every environment. Accepts "http://api:3001", "https://api.example.com"
 * or a bare "host:port" (what Render's private network gives a service).
 */
export function apiOrigin(raw: string | undefined = process.env.API_ORIGIN): string {
  const v = (raw ?? "").trim().replace(/\/+$/, "") || "http://localhost:3001";
  return /^https?:\/\//i.test(v) ? v : `http://${v}`;
}
