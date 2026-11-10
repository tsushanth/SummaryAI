/**
 * Retry policy for the browser's PUT of the audio to the signed storage URL (no imports, so node loads this directly:
 * scripts/uploadRetry.test.mjs).
 *
 * Why: the Android app already retries this PUT on 502/503/504, timeouts and dropped connections (PR #52, #64); the web
 * upload gave up on the first blip with a bare "Upload failed". Evidence (2026-11): every 504 on this PUT came from the
 * storage edge, not from our backend, and a retry a few seconds later is what recovers it.
 */

export class UploadError extends Error {
  /** HTTP status of the storage answer; 0 when the request never completed (network error, timeout, abort). */
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

/** Transient: network failure / timeout (status 0), 408, 429 and any 5xx. Everything else (403 expired link, 400, 413...) will not get better. */
export function isRetryableUploadStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export const UPLOAD_MAX_ATTEMPTS = 3;
/** 1.5 s, then 4 s. */
export function uploadRetryDelayMs(attemptJustFailed: number): number {
  return attemptJustFailed <= 1 ? 1500 : 4000;
}

/** What the page shows when the last attempt failed. The audio is still saved in this browser (see pendingUpload.ts), so say that. */
export function uploadFailureMessage(status: number): string {
  if (status === 403) return 'The upload link expired. Press Create Recording again to retry.';
  if (status === 413) return 'This file is too large to upload.';
  return isRetryableUploadStatus(status)
    ? 'The upload did not go through (connection or server busy). Your recording is saved in this browser: try again in a moment.'
    : 'The upload was rejected. Try again, or contact support if it keeps happening.';
}

/**
 * Runs `attempt` up to `maxAttempts` times, retrying only transient UploadErrors. `onRetry` lets the caller reset its progress
 * bar. Any non-UploadError (programmer error) is rethrown at once.
 */
export async function withUploadRetry<T>(
  attempt: () => Promise<T>,
  opts: { maxAttempts?: number; sleep?: (ms: number) => Promise<void>; onRetry?: (failedAttempt: number, status: number) => void } = {},
): Promise<T> {
  const max = opts.maxAttempts ?? UPLOAD_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let n = 1; ; n++) {
    try {
      return await attempt();
    } catch (e) {
      if (!(e instanceof UploadError) || !isRetryableUploadStatus(e.status) || n >= max) throw e;
      opts.onRetry?.(n, e.status);
      await sleep(uploadRetryDelayMs(n));
    }
  }
}
