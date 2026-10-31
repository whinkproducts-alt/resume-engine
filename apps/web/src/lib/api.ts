"use client";

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function tryRefresh(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: string };
    if (data.accessToken) {
      accessToken = data.accessToken;
      return data.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

export interface ApiOptions extends RequestInit {
  retryOn401?: boolean;
  extraHeaders?: Record<string, string>;
}

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { retryOn401 = true, extraHeaders, ...init } = opts;

  const doFetch = (token: string | null) => {
    const headers = new Headers(init.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
    }
    return fetch(path, { ...init, headers, credentials: "include" });
  };

  let res = await doFetch(accessToken);
  if (res.status === 401 && retryOn401) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await doFetch(refreshed);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(text || `Request failed (${res.status})`), {
      status: res.status,
    });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* Convenience wrappers */
export const api = {
  get: <T>(p: string, opts?: ApiOptions) => apiFetch<T>(p, { ...opts, method: "GET" }),
  post: <T>(p: string, body?: unknown, opts?: ApiOptions) =>
    apiFetch<T>(p, {
      ...opts,
      method: "POST",
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(p: string, body?: unknown, opts?: ApiOptions) =>
    apiFetch<T>(p, {
      ...opts,
      method: "PATCH",
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    }),
  del: <T>(p: string, opts?: ApiOptions) => apiFetch<T>(p, { ...opts, method: "DELETE" }),
};

/* SSE / polling helper for run progress */
export function subscribeRunProgress(
  runId: string,
  onEvent: (data: { stage: string; status: Run["status"] }) => void
): () => void {
  // Prefer SSE if available; fall back to polling every 2s.
  let closed = false;
  let es: EventSource | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const startPolling = () => {
    interval = setInterval(async () => {
      if (closed) return;
      try {
        const r = await api.get<{ status: Run["status"]; stageLabel?: string }>(
          `/api/runs/${runId}`
        );
        onEvent({ stage: r.stageLabel || "", status: r.status });
        if (r.status === "review" || r.status === "completed" || r.status === "failed") {
          cleanup();
        }
      } catch {
        /* noop — keep polling */
      }
    }, 2000);
  };

  try {
    es = new EventSource(`/api/runs/${runId}/stream`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { stage: string; status: Run["status"] };
        onEvent(data);
        if (data.status === "review" || data.status === "completed" || data.status === "failed") {
          cleanup();
        }
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => {
      es?.close();
      es = null;
      if (!closed) startPolling();
    };
  } catch {
    startPolling();
  }

  const cleanup = () => {
    closed = true;
    es?.close();
    if (interval) clearInterval(interval);
  };

  return cleanup;
}
