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
 *  - Second pass (sweepStuckUploadsWithDuration): clients that send the length at create time (Android always, web since the
 *    duration fix) leave a row that the first pass never matches, so it stayed 'uploading' for weeks. Same status change, but only after STUCK_WITH_DURATION_HOURS (24) AND only when no audio object exists
 *    in storage, so a file that did land (complete-upload missing) is never marked failed.
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

/** A row with a length that is still 'uploading' this long after its last update cannot be in flight (signed URL = 1 h). */
export const STUCK_WITH_DURATION_HOURS = 24;
const STUCK_BATCH = 50;
const AUDIO_BUCKET = () => process.env.STORAGE_BUCKET_AUDIO || 'recordings-audio';

/** True only when the storage listing succeeded and shows no object with that name (any error counts as "maybe exists"). */
async function audioObjectMissing(filePath: string): Promise<boolean> {
  const slash = filePath.lastIndexOf('/');
  const dir = slash >= 0 ? filePath.slice(0, slash) : '';
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const { data, error } = await supabaseAdmin.storage.from(AUDIO_BUCKET()).list(dir, { limit: 10, search: name });
  if (error || !Array.isArray(data)) return false;
  return !data.some((o: { name?: string }) => o.name === name);
}

/** Returns how many recordings were marked failed. Status change only; idempotent. */
export async function sweepStuckUploadsWithDuration(now: number = Date.now()): Promise<number> {
  const cutoffIso = new Date(now - STUCK_WITH_DURATION_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('recordings')
    .select('id, file_path')
    .eq('status', 'uploading')
    .is('meeting_id', null)
    .gt('duration_seconds', 0)
    .not('file_path', 'is', null)
    .lt('updated_at', cutoffIso)
    .limit(STUCK_BATCH);
  if (error) {
    console.error(`${TAG} stuck-with-duration scan failed:`, error.message);
    reportLoopScanError(LOOP);
    return 0;
  }
  const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; file_path: string | null }>;
  const ids: string[] = [];
  for (const r of rows) {
    if (r.id && r.file_path && (await audioObjectMissing(r.file_path))) ids.push(r.id);
  }
  if (ids.length === 0) return 0;
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('recordings')
    .update({
      status: 'failed',
      error_code: ABANDONED_UPLOAD_CODE,
      error_message: ABANDONED_UPLOAD_MESSAGE,
      updated_at: new Date(now).toISOString(),
    })
    .in('id', ids)
    .eq('status', 'uploading') // a row that moved on in the meantime no longer matches
    .select('id');
  if (updErr) {
    console.error(`${TAG} stuck-with-duration update failed:`, updErr.message);
    reportLoopScanError(LOOP);
    return 0;
  }
  const n = Array.isArray(updated) ? updated.length : 0;
  if (n > 0) console.log(`${TAG} marked ${n} stuck upload(s) with a length failed (older than ${STUCK_WITH_DURATION_HOURS} h, no audio object)`);
  return n;
}

export function startAbandonedUploadSweepLoop(): void {
  registerLoop(LOOP, ABANDONED_SCAN_INTERVAL_MS);
  const pass = async () => (await sweepAbandonedUploads()) + (await sweepStuckUploadsWithDuration());
  void runLoopPass(LOOP, pass);
  setInterval(() => {
    void runLoopPass(LOOP, pass);
  }, ABANDONED_SCAN_INTERVAL_MS);
  console.log(`${TAG} loop started (interval=${ABANDONED_SCAN_INTERVAL_MS / 60000}min)`);
}
