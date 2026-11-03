import { describe, it, expect, vi, beforeEach } from "vitest";

// Uses the REAL supabase-js client (no createClient mock) to prove the auth middleware works when
// SUPABASE_ANON_KEY is an opaque `sb_publishable_` key instead of the legacy anon JWT: the key must only
// ever be sent as `apikey`, the user's token must be the Bearer, and nothing may try to decode the key.
const PUBLISHABLE = "sb_publishable_testkey_abcdef0123456789";
const calls: { url: string; headers: Headers }[] = [];
let respond: (url: string) => Response;

vi.mock("../src/config/index.js", () => ({
  config: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: PUBLISHABLE, AUTH_TIMEOUT_MS: 2000 },
}));

const { authenticate, optionalAuth } = await import("../src/middleware/auth.js");

function run(mw: any, token = "user.jwt.token") {
  const req: any = { method: "GET", path: "/", headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  const next = vi.fn();
  return mw(req, res, next).then(() => ({ req, res, next }));
}

beforeEach(() => {
  calls.length = 0;
  respond = () =>
    new Response(JSON.stringify({ id: "u1", email: "a@b.c", role: "authenticated", aud: "authenticated" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  vi.stubGlobal("fetch", async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, headers: new Headers(init.headers) });
    return respond(url);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("auth middleware with a non-JWT (sb_publishable_) apikey", () => {
  it("verifies the token via /auth/v1/user with apikey=publishable and Bearer=user token", async () => {
    const { req, next, res } = await run(authenticate);
    expect(res.statusCode).toBe(200);
    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ id: "u1", email: "a@b.c" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://x.supabase.co/auth/v1/user");
    expect(calls[0].headers.get("apikey")).toBe(PUBLISHABLE);
    expect(calls[0].headers.get("authorization")).toBe("Bearer user.jwt.token");
  });

  it("never sends the publishable key as the Bearer when there is a user token", async () => {
    await run(authenticate);
    await run(optionalAuth);
    for (const c of calls) expect(c.headers.get("authorization")).not.toContain(PUBLISHABLE);
  });

  it("an invalid user token still yields 401 INVALID_TOKEN (gateway answers 401 for the user token, not the key)", async () => {
    respond = () =>
      new Response(JSON.stringify({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    const { res, next } = await run(authenticate);
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
    expect(next).not.toHaveBeenCalled();
  });

  it("optionalAuth attaches the user with the publishable key", async () => {
    const { req, next } = await run(optionalAuth);
    expect(req.user).toMatchObject({ id: "u1" });
    expect(next).toHaveBeenCalled();
  });
});
