import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { requestTiming, runtimeSnapshot } from "../src/lib/requestTiming.js";

function fakeReqRes(path = "/v1/api/recordings?page=2&secret=x", status = 200) {
  const req: any = { method: "GET", originalUrl: path, path };
  const res: any = Object.assign(new EventEmitter(), { statusCode: status });
  return { req, res };
}

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("requestTiming", () => {
  it("is silent for fast requests", () => {
    const { req, res } = fakeReqRes();
    requestTiming(1000)(req, res, () => {});
    vi.advanceTimersByTime(200);
    res.emit("finish"); res.emit("close");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("logs slow requests with path only (no query string, ids normalised)", () => {
    const { req, res } = fakeReqRes("/v1/api/recordings/0b1f6f0e-1111-2222-3333-444455556666?token=abc");
    requestTiming(1000)(req, res, () => {});
    vi.advanceTimersByTime(2500);
    res.emit("finish"); res.emit("close");
    const line = (console.warn as any).mock.calls[0][0] as string;
    expect(line).toContain("[SlowRequest]");
    expect(line).toContain("/v1/api/recordings/:id");
    expect(line).not.toContain("token");
    expect(line).not.toContain("abc");
  });

  it("logs a request whose connection closed before a response was sent", () => {
    const { req, res } = fakeReqRes();
    requestTiming(1000)(req, res, () => {});
    vi.advanceTimersByTime(60000);
    res.emit("close");
    const line = (console.warn as any).mock.calls[0][0] as string;
    expect(line).toContain("[RequestAborted]");
    expect(line).toContain("60000ms");
  });
});

describe("runtimeSnapshot", () => {
  it("reports memory and event-loop numbers", () => {
    const s = runtimeSnapshot();
    expect(s.rssMb).toBeGreaterThan(0);
    expect(typeof s.lagP99Ms).toBe("number");
  });
});
