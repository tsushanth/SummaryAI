import { describe, it, expect, vi, beforeEach } from "vitest";

// Records how the Supabase client was built and lets each test choose what getUser does.
let getUserImpl: () => Promise<any>;
const createClientCalls: any[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn((_url: string, _key: string, opts: any) => {
    createClientCalls.push(opts);
    return { auth: { getUser: () => getUserImpl() } };
  }),
}));
vi.mock("../src/config/index.js", () => ({
  config: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", AUTH_TIMEOUT_MS: 50 },
}));

const { authenticate, optionalAuth, isAuthUnavailable, fetchWithTimeout } = await import("../src/middleware/auth.js");

function run(mw: any, token = "tok") {
  const req: any = { method: "GET", path: "/", headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  const next = vi.fn();
  return mw(req, res, next).then(() => ({ req, res, next }));
}

beforeEach(() => {
  createClientCalls.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("isAuthUnavailable", () => {
  it("is true for retryable fetch errors, network failures (status 0) and 5xx from Supabase Auth", () => {
    expect(isAuthUnavailable({ name: "AuthRetryableFetchError", status: 0 })).toBe(true);
    expect(isAuthUnavailable({ name: "AuthApiError", status: 0 })).toBe(true);
    expect(isAuthUnavailable({ name: "AuthApiError", status: 502 })).toBe(true);
  });
  it("is false for a genuinely bad token", () => {
    expect(isAuthUnavailable({ name: "AuthApiError", status: 401 })).toBe(false);
    expect(isAuthUnavailable({ name: "AuthApiError", status: 403 })).toBe(false);
    expect(isAuthUnavailable(null)).toBe(false);
  });
});

describe("authenticate", () => {
  it("attaches the user on success (unchanged)", async () => {
    getUserImpl = async () => ({ data: { user: { id: "u1", email: "a@b.c", role: "authenticated" } }, error: null });
    const { req, next } = await run(authenticate);
    expect(req.user).toMatchObject({ id: "u1" });
    expect(next).toHaveBeenCalled();
  });

  it("still answers 401 for an invalid token (unchanged)", async () => {
    getUserImpl = async () => ({ data: { user: null }, error: { name: "AuthApiError", status: 401, message: "bad" } });
    const { res, next } = await run(authenticate);
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
    expect(next).not.toHaveBeenCalled();
  });

  it("answers 503 (not 401, so clients do not sign out) when Supabase Auth is unreachable or times out", async () => {
    getUserImpl = async () => ({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" } });
    const { res, next } = await run(authenticate);
    expect(res.statusCode).toBe(503);
    expect(res.body.error.code).toBe("AUTH_UNAVAILABLE");
    expect(next).not.toHaveBeenCalled();
  });

  it("builds the Supabase client with a bounded fetch", async () => {
    getUserImpl = async () => ({ data: { user: { id: "u1" } }, error: null });
    await run(authenticate);
    expect(typeof createClientCalls[0].global.fetch).toBe("function");
  });
});

describe("optionalAuth", () => {
  it("treats a missing token as a guest (unchanged)", async () => {
    const { req, next } = await run(optionalAuth, "");
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("treats an invalid token as a guest (unchanged)", async () => {
    getUserImpl = async () => ({ data: { user: null }, error: { name: "AuthApiError", status: 401, message: "bad" } });
    const { req, next } = await run(optionalAuth);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("answers 503 instead of silently serving a guest (empty list) when Supabase Auth is down", async () => {
    getUserImpl = async () => ({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "x" } });
    const { res, next } = await run(optionalAuth);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("fetchWithTimeout", () => {
  it("aborts a request that outlives the timeout", async () => {
    const hang = vi.fn((_i: any, init: any) => new Promise((_res, rej) => {
      init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
    }));
    const f = fetchWithTimeout(hang as any, 30);
    await expect(f("https://x")).rejects.toThrow();
    expect(hang).toHaveBeenCalledTimes(1);
  });
  it("passes a fast response through", async () => {
    const f = fetchWithTimeout((async () => new Response("ok")) as any, 1000);
    expect(await (await f("https://x")).text()).toBe("ok");
  });
});
