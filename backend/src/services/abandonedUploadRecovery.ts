/**
 * Sweeper for uploads that were created but never completed.
 *
 * A client that taps record and stops at once (duration 0) creates the recording row, never uploads or never calls
 * complete-upload, and the row stays 'uploading' forever (15 of them at 2026-11-01). The user sees an endless
 * "Uploading" entry. We mark them failed with error_code FAILED_UPLOAD and a friendly message.
 *
 * Safety:
 *  - STATUS CHANGE ONLY. No row and no storage object is deleted; transcripts/summaries are untouched.
 *  - Only user uploads: meeting_id IS NULL (a meeting-bot recording legitimately stays 'uploading' for the whole call),
 *    duration_seconds NULL or 0 (the API stores a reported 0 as NULL), still 'uploading', and untouched for
 *    ABANDONED_UPLOAD_HOURS (default 6; the signed upload URL expires after 1 h).
 *  - One conditional UPDATE: a row that moved on in the meantime no longer matches, and a second run matches nothing (idempotent).
 *  - Uses the existing 'failed' enum value, so no migration is needed and old clients (whose status enum has no new values) keep working.
 */
import { supabaseAdmin } from '../lib/supabase.js';
import { registerLoop, runLoopPass, reportLoopScanError } from '../lib/loopMonitor.js';
import { getRecordingLimits, type RecordingLimits } from '../config/recordingLimits.js';
import { FAILED_UPLOAD_CODE, FAILED_UPLOAD_MESSAGE } from './shortRecordingGuard.js';

export const ABANDONED_UPLOAD_CODE = FAILED_UPLOAD_CODE;
export const ABANDONED_UPLOAD_MESSAGE = FAILED_UPLOAD_MESSAGE;
export const ABANDONED_SCAN_INTERVAL_MS = 30 * 60 * 1000;
const LOOP = 'AbandonedUploads';
const TAG = '[AbandonedUploads]';

/** Returns how many recordings were marked failed. */
export async function sweepAbandonedUploads(
  now: number = Date.now(),
  limits: RecordingLimits = getRecordingLimits()
): Promise<number> {
  const cutoffIso = new Date(now - limits.abandonedUploadHours * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('recordings')
    .update({
      status: 'failed',
      error_code: ABANDONED_UPLOAD_CODE,
      error_message: ABANDONED_UPLOAD_MESSAGE,
      updated_at: new Date(now).toISOString(),
    })
    .eq('status', 'uploading')
    .is('meeting_id', null)
    .or('duration_seconds.is.null,duration_seconds.eq.0')
    .lt('updated_at', cutoffIso)
    .select('id');
  if (error) {
    console.error(`${TAG} sweep failed:`, error.message);
    reportLoopScanError(LOOP);
    return 0;
  }
  const n = Array.isArray(data) ? data.length : 0;
  if (n > 0) console.log(`${TAG} marked ${n} abandoned upload(s) failed (older than ${limits.abandonedUploadHours} h, no duration)`);
  return n;
}

export function startAbandonedUploadSweepLoop(): void {
  registerLoop(LOOP, ABANDONED_SCAN_INTERVAL_MS);
  void runLoopPass(LOOP, () => sweepAbandonedUploads());
  setInterval(() => {
    void runLoopPass(LOOP, () => sweepAbandonedUploads());
  }, ABANDONED_SCAN_INTERVAL_MS);
  console.log(`${TAG} loop started (interval=${ABANDONED_SCAN_INTERVAL_MS / 60000}min)`);
}
