/**
 * Stable-message alerts for the central failure reporter (Cloudflare Worker, dedupes per fingerprint per hour).
 *
 * Rules: the message is fixed per class (so repeats dedupe into one email an hour), context holds ONLY non-content
 * strings (codes, counts, provider names), never user ids, emails, titles or transcript text. Fire-and-forget; silent in
 * tests (failureReporter is disabled when NODE_ENV=test). A per-process throttle keeps a failure loop from POSTing on
 * every call (the Worker would dedupe, but each POST costs a request).
 */
import { reportFailure } from './failureReporter.js';

const THROTTLE_MS = 10 * 60_000;
const lastSent = new Map<string, number>();

/** Test hook. */
export function resetAlertThrottle(): void {
  lastSent.clear();
}

function cleanContext(ctx: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v).replace(/[\r\n]+/g, ' ').slice(0, 80);
  }
  return out;
}

/**
 * One alert class. flow = area ("provider_unavailable"), code = stable class ("DEEPGRAM_AUTH").
 * Returns true when it was sent (false when throttled), mainly for tests.
 */
export function reportAlert(flow: string, code: string, context: Record<string, unknown> = {}, throttleMs: number = THROTTLE_MS): boolean {
  try {
    const key = `${flow}:${code}`;
    const now = Date.now();
    const prev = lastSent.get(key);
    if (prev !== undefined && now - prev < throttleMs) return false;
    lastSent.set(key, now);
    reportFailure(flow, new Error(`${flow}: ${code}`), { code, ...cleanContext(context) });
    return true;
  } catch {
    return false; // reporting must never cause a failure of its own
  }
}

export type ProviderErrorClass = 'AUTH' | 'CREDIT' | 'RATE_LIMIT' | 'TIMEOUT' | 'SERVER' | 'NETWORK' | 'CLIENT' | 'UNKNOWN';

function statusOf(err: unknown): number | null {
  const e = err as { status?: unknown; statusCode?: unknown; message?: unknown } | null;
  for (const v of [e?.status, e?.statusCode]) if (typeof v === 'number' && v >= 100 && v < 600) return v;
  const m = typeof e?.message === 'string' ? e.message.match(/(?:error|status|HTTP)\D{0,6}\b([1-5]\d\d)\b/i) : null;
  return m ? Number(m[1]) : null;
}

/** Maps a provider SDK/HTTP error to a stable class. The message text is only matched, never forwarded. */
export function classifyProviderError(err: unknown): ProviderErrorClass {
  const e = err as { name?: unknown; code?: unknown; message?: unknown } | null;
  const msg = typeof e?.message === 'string' ? e.message : typeof err === 'string' ? err : '';
  const status = statusOf(err);
  if (status === 402 || /credit balance|insufficient (credit|fund|balance)|quota (exceeded|exhausted)|billing|payment required|out of credit/i.test(msg)) return 'CREDIT';
  if (status === 401 || status === 403 || /invalid[ _-]?(x-)?api[ _-]?key|authentication|unauthori[sz]ed|invalid credentials|forbidden|permission_error/i.test(msg)) return 'AUTH';
  if (status === 429 || /rate.?limit/i.test(msg)) return 'RATE_LIMIT';
  if (status === 408 || status === 504 || /timed? ?out|timeout|ETIMEDOUT|AbortError|TimeoutError/i.test(`${msg} ${String(e?.name ?? '')} ${String(e?.code ?? '')}`)) return 'TIMEOUT';
  if ((status !== null && status >= 500) || /overloaded/i.test(msg)) return 'SERVER';
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network/i.test(`${msg} ${String(e?.code ?? '')}`)) return 'NETWORK';
  if (status !== null && status >= 400) return 'CLIENT';
  return 'UNKNOWN';
}

/**
 * A call to a third-party provider failed. A rejected key or exhausted credit is provider-WIDE (every call fails until
 * someone acts), so it gets its own flow and one clear alert per provider; everything else is a per-class provider error.
 */
export function reportProviderFailure(provider: string, err: unknown, context: Record<string, unknown> = {}): ProviderErrorClass {
  // A call WE aborted (live-coaching cancel) is not a provider failure.
  if (/UserAbort/i.test(String((err as { name?: unknown } | null)?.name ?? ''))) return 'UNKNOWN';
  const cls = classifyProviderError(err);
  const name = provider.toUpperCase();
  if (cls === 'AUTH' || cls === 'CREDIT') {
    reportAlert('provider_unavailable', `${name}_${cls}`, { provider, class: cls, ...context });
  } else {
    reportAlert('provider_error', `${name}_${cls}`, { provider, class: cls, ...context });
  }
  return cls;
}

/** Same, when only the HTTP status is known (error body is never forwarded). */
export function reportProviderHttpFailure(provider: string, status: number, context: Record<string, unknown> = {}): void {
  reportProviderFailure(provider, { status }, { status, ...context });
}
