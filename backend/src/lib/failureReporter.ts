/**
 * Sends backend failures to the unified app-failure-reporter Worker (dedupes and emails).
 * Fire-and-forget: never throws, never blocks a request. Set FAILURE_REPORTER_DISABLED=1 to silence (tests/dev).
 * Never pass user content (transcripts, note text, emails) as message or context.
 */
const ENDPOINT = process.env.FAILURE_REPORTER_URL || 'https://app-failure-reporter.t-sushanth.workers.dev/v1/report';
const KEY = process.env.FAILURE_REPORTER_KEY || 'afr_a60112f598c3f7206a8ecb8866dc22c3';
const APP_VERSION = process.env.FLY_IMAGE_REF || process.env.K_REVISION || process.env.npm_package_version || 'unknown';
// Test runners (node --test, vitest, jest) must never post to the production reporter, even when NODE_ENV is unset or overridden.
// A test that stubs fetch itself can opt back in with FAILURE_REPORTER_FORCE=1.
const IN_TEST_RUNNER = !!(process.env.VITEST || process.env.JEST_WORKER_ID || process.env.NODE_TEST_CONTEXT);
const DISABLED = process.env.FAILURE_REPORTER_DISABLED === '1' || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development' || (IN_TEST_RUNNER && process.env.FAILURE_REPORTER_FORCE !== '1');

type Kind = 'crash' | 'failure' | 'backend_error';

async function post(kind: Kind, flow: string, err: unknown, context: Record<string, string>, timeoutMs: number, userRef?: string): Promise<void> {
  if (DISABLED) return;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Report-Key': KEY },
      body: JSON.stringify({ kind, platform: 'backend', version: APP_VERSION, flow, message: e.message || e.name, stack: e.stack ?? '', context, ...(userRef ? { user: { ref: userRef } } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { /* reporting must never cause a failure of its own */ }
}

/** A handled server error (5xx). Path only: never log query strings, they can carry tokens. */
export function reportBackendError(req: { method: string; path?: string; user?: { id?: string } }, err: unknown, statusCode: number): void {
  if (statusCode < 500) return;
  // The affected user's account id (opaque, never the email) so the owner can find and contact them. Absent when the
  // request failed before authentication.
  void post('backend_error', `${req.method} ${(req.path ?? '').replace(/(\/api\/public\/shares\/)[^/?#\s]+/g, '$1[redacted]')}`, err, { status: String(statusCode) }, 5000, req.user?.id);
}

/** A background job or flow failed (worker, queue, cron). */
export function reportFailure(flow: string, err: unknown, context: Record<string, string> = {}): void {
  void post('failure', flow, err, context, 5000);
}

/** Process is about to die: await this before process.exit so the email actually goes out. */
export function reportCrash(flow: string, err: unknown): Promise<void> {
  return post('crash', flow, err, {}, 2500);
}
