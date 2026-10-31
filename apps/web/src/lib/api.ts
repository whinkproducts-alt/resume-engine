"use client";

// Client for the backend contract (01-SPEC-v3.md section 7). Every path is under
// /v1; Next proxies /v1 to the API (next.config.mjs) so the refresh cookie
// (Path=/v1/auth, HttpOnly) is first party.

import type { RunProgress } from "./types";
import { TERMINAL_STATUSES } from "./types";

export const API = "/v1";

/** The backend error envelope: { error: { code, message } }. */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/** One refresh at a time: concurrent 401s share a single rotation of the refresh cookie. */
let refreshing: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken?: string };
        accessToken = data.accessToken ?? null;
        return accessToken;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = "HTTP_ERROR";
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string | string[] } };
    if (body.error?.code) code = body.error.code;
    const m = body.error?.message;
    if (m) message = Array.isArray(m) ? m.join(", ") : m;
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, code, message);
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | null;
  retryOn401?: boolean;
  extraHeaders?: Record<string, string>;
}

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { retryOn401 = true, extraHeaders, ...init } = opts;
  const url = path.startsWith("/v1/") ? path : `${API}${path}`;

  const send = (token: string | null) => {
    const headers = new Headers(init.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    for (const [k, v] of Object.entries(extraHeaders ?? {})) headers.set(k, v);
    return fetch(url, { ...init, headers, credentials: "include" });
  };

  let res = await send(accessToken);
  if (res.status === 401 && retryOn401 && !path.startsWith("/auth/")) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown): BodyInit | undefined =>
  body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body);

export const api = {
  get: <T>(p: string, o?: ApiOptions) => apiFetch<T>(p, { ...o, method: "GET" }),
  post: <T>(p: string, body?: unknown, o?: ApiOptions) =>
    apiFetch<T>(p, { ...o, method: "POST", body: json(body) }),
  put: <T>(p: string, body?: unknown, o?: ApiOptions) =>
    apiFetch<T>(p, { ...o, method: "PUT", body: json(body) }),
  patch: <T>(p: string, body?: unknown, o?: ApiOptions) =>
    apiFetch<T>(p, { ...o, method: "PATCH", body: json(body) }),
  del: <T>(p: string, o?: ApiOptions) => apiFetch<T>(p, { ...o, method: "DELETE" }),
};

/* ---------------------------- run progress stream --------------------------- */

/** Pulls the JSON payloads out of a chunk of an SSE stream; returns the unconsumed tail. */
export function parseSse(buffer: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      /* ignore a malformed event */
    }
  }
  return { events, rest };
}

/**
 * Progress for a run. EventSource cannot send an Authorization header, so the
 * stream is read with fetch. If it fails, fall back to polling GET /runs/:id every
 * 2 seconds (01-SPEC-v3.md section 9). Returns a function that stops everything.
 */
export function subscribeRunProgress(runId: string, onEvent: (p: RunProgress) => void): () => void {
  let closed = false;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const done = (p: RunProgress) => TERMINAL_STATUSES.includes(p.status) || p.status === "AWAITING_COMPANY_CONFIRM";

  const poll = async () => {
    if (closed) return;
    try {
      const r = await api.get<RunProgress>(`/runs/${runId}`);
      onEvent(r);
      if (done(r)) return;
    } catch {
      /* keep polling */
    }
    timer = setTimeout(poll, 2000);
  };

  const stream = async () => {
    try {
      const res = await fetch(`${API}/runs/${runId}/events`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: "include",
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("stream unavailable");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSse(buffer);
        buffer = parsed.rest;
        for (const e of parsed.events) onEvent(e as RunProgress);
      }
    } catch {
      if (!closed) void poll();
    }
  };

  void stream();
  return () => {
    closed = true;
    controller.abort();
    if (timer) clearTimeout(timer);
  };
}
