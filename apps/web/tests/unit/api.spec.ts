import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, getAccessToken, parseSse, refreshAccessToken, setAccessToken } from "@/lib/api";

type Call = { url: string; init: RequestInit };
let calls: Call[];
let responder: (url: string, init: RequestInit) => Response | Promise<Response>;

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  calls = [];
  setAccessToken(null);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return responder(url, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

describe("apiFetch", () => {
  it("prefixes /v1, sends the bearer token and credentials, and parses JSON", async () => {
    setAccessToken("tok");
    responder = () => json(200, { ok: true });
    await expect(api.get("/runs?limit=5")).resolves.toEqual({ ok: true });
    expect(calls[0]!.url).toBe("/v1/runs?limit=5");
    expect(header(calls[0]!, "Authorization")).toBe("Bearer tok");
    expect(calls[0]!.init.credentials).toBe("include");
  });

  it("sends JSON bodies with a content type, but leaves FormData to the browser", async () => {
    responder = () => json(200, {});
    await api.post("/runs", { a: 1 });
    expect(calls[0]!.init.body).toBe('{"a":1}');
    expect(header(calls[0]!, "Content-Type")).toBe("application/json");

    const fd = new FormData();
    fd.append("file", new Blob(["x"]), "x.txt");
    await api.post("/profiles/p/bases", fd);
    expect(calls[1]!.init.body).toBe(fd);
    expect(header(calls[1]!, "Content-Type")).toBeNull();
  });

  it("returns undefined for 204", async () => {
    responder = () => new Response(null, { status: 204 });
    await expect(api.del("/runs/x")).resolves.toBeUndefined();
  });

  it("turns the backend error envelope into an ApiError with status, code and message", async () => {
    responder = () => json(402, { error: { code: "RUN_LIMIT_REACHED", message: "Monthly run limit reached." } });
    const err = await api.post("/runs", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 402, code: "RUN_LIMIT_REACHED", message: "Monthly run limit reached." });
  });

  it("joins validation message arrays and survives a non JSON error body", async () => {
    responder = () => json(400, { error: { code: "HTTP_ERROR", message: ["name must be a string", "email must be an email"] } });
    expect(await api.post("/x", {}).catch((e) => e.message)).toBe("name must be a string, email must be an email");

    responder = () => new Response("<html>bad gateway</html>", { status: 502 });
    expect(await api.get("/x").catch((e) => e)).toMatchObject({ status: 502, code: "HTTP_ERROR", message: "Request failed (502)" });
  });
});

describe("401 handling and refresh", () => {
  it("refreshes once through the cookie, then retries the request with the new token", async () => {
    setAccessToken("old");
    responder = (url, init) => {
      if (url === "/v1/auth/refresh") return json(200, { accessToken: "new" });
      return new Headers(init.headers).get("Authorization") === "Bearer new" ? json(200, { ok: 1 }) : json(401, { error: { code: "UNAUTHORIZED", message: "x" } });
    };
    await expect(api.get("/runs")).resolves.toEqual({ ok: 1 });
    expect(calls.map((c) => c.url)).toEqual(["/v1/runs", "/v1/auth/refresh", "/v1/runs"]);
    expect(calls[1]!.init).toMatchObject({ method: "POST", credentials: "include" });
    expect(getAccessToken()).toBe("new");
  });

  it("shares one refresh between concurrent 401s (single flight)", async () => {
    setAccessToken("old");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    responder = async (url, init) => {
      if (url === "/v1/auth/refresh") { await gate; return json(200, { accessToken: "new" }); }
      return new Headers(init.headers).get("Authorization") === "Bearer new" ? json(200, {}) : json(401, {});
    };
    const all = Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);
    await new Promise((r) => setTimeout(r, 10));
    release();
    await all;
    expect(calls.filter((c) => c.url === "/v1/auth/refresh")).toHaveLength(1);
  });

  it("gives up with the 401 when the refresh fails", async () => {
    responder = (url) => (url === "/v1/auth/refresh" ? json(401, {}) : json(401, { error: { code: "UNAUTHORIZED", message: "no" } }));
    await expect(api.get("/runs")).rejects.toMatchObject({ status: 401 });
  });

  it("never tries to refresh for auth endpoints (a wrong password is just a 401)", async () => {
    responder = () => json(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } });
    await expect(api.post("/auth/login", { email: "a", password: "b" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(calls).toHaveLength(1);
  });

  it("refreshAccessToken resolves null on a network error", async () => {
    responder = () => { throw new Error("offline"); };
    await expect(refreshAccessToken()).resolves.toBeNull();
  });
});

describe("parseSse", () => {
  it("extracts JSON events, keeps a partial tail, ignores comments and junk", () => {
    const chunk = 'id: 1\ndata: {"status":"REWRITING"}\n\n: keepalive\n\nid: 2\ndata: not json\n\nid: 3\ndata: {"status":"COM';
    const out = parseSse(chunk);
    expect(out.events).toEqual([{ status: "REWRITING" }]);
    expect(out.rest).toBe('id: 3\ndata: {"status":"COM');
    expect(parseSse(out.rest + 'PLETE"}\n\n').events).toEqual([{ status: "COMPLETE" }]);
  });
});
