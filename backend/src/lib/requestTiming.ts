/**
 * Request and runtime timing, so a Fly proxy 504 can be attributed.
 *
 * A 504 produced by the Fly proxy never reaches the app, so serverErrorReporter and morgan cannot see it. What the app
 * can see is (a) requests that took long, (b) requests whose connection closed before a response was written, and
 * (c) whether the event loop / memory were in trouble at the time. Paths are normalised and never include the query.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Request, Response, NextFunction } from 'express';
import { normalizePath } from '../middleware/serverErrorReporter.js';

const histogram = monitorEventLoopDelay({ resolution: 20 });
let histogramOn = false;

export function requestTiming(slowMs = 3000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = Date.now();
    let finished = false;
    res.on('finish', () => { finished = true; });
    res.on('close', () => {
      try {
        const ms = Date.now() - started;
        const path = normalizePath(req.originalUrl ? req.originalUrl.split('?')[0] : req.path);
        if (!finished) {
          console.warn(`[RequestAborted] ${req.method} ${path} closed before a response after ${ms}ms`);
        } else if (ms >= slowMs) {
          console.warn(`[SlowRequest] ${req.method} ${path} ${res.statusCode} ${ms}ms`);
        }
      } catch { /* never throws */ }
    });
    next();
  };
}

export function runtimeSnapshot() {
  const m = process.memoryUsage();
  const toMs = (ns: number) => (Number.isFinite(ns) ? Math.round(ns / 1e6) : 0);
  return {
    rssMb: Math.round(m.rss / 1048576),
    heapMb: Math.round(m.heapUsed / 1048576),
    lagP99Ms: toMs(histogram.percentile(99)),
    lagMaxMs: toMs(histogram.max),
  };
}

/** One summary line every `summaryEveryN` ticks (default 5 min), and an immediate WARN line when the loop stalls or memory is high. */
export function startRuntimeMonitor(intervalMs = 60_000, summaryEveryN = 5): NodeJS.Timeout {
  if (!histogramOn) { histogram.enable(); histogramOn = true; }
  let n = 0;
  const t = setInterval(() => {
    n += 1;
    const s = runtimeSnapshot();
    histogram.reset();
    const bad = s.lagMaxMs >= 1000 || s.rssMb >= 1500;
    const line = `[Runtime] rss=${s.rssMb}MB heap=${s.heapMb}MB loop_lag_p99=${s.lagP99Ms}ms loop_lag_max=${s.lagMaxMs}ms`;
    if (bad) console.warn(line.replace('[Runtime]', '[Runtime] WARN'));
    else if (n % summaryEveryN === 0) console.log(line);
  }, intervalMs);
  t.unref();
  return t;
}
