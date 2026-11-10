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
 *  - Third pass (recoverLandedUploads): the opposite case. The audio DID land in storage but complete-upload never succeeded
 *    (the app lost the connection, or the backend answered 5xx to that one call). Such a row stayed 'uploading' forever (two
 *    March 2026 rows, found 2026-11-10) because pass two deliberately never fails a row whose object exists. Once the signed URL is
 *    gone (1 h) a row whose object exists with the expected size is moved to 'uploaded' (conditional update) and, if it is younger
 *    than 24 h, processed now exactly as complete-upload would; an older one is left in 'uploaded' for the orphan sweeper, which marks
 *    it failed PROCESSING_INTERRUPTED ("tap retry") instead of firing integrations long after the meeting.
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

/** How long after the last update a still-'uploading' row can no longer have an upload in flight (signed URL lifetime is 1 h). */
export const LANDED_MIN_IDLE_HOURS = 1;
/** Younger than this a recovered row is processed immediately; older ones are handed to the orphan sweeper (see header). */
export const LANDED_PROCESS_MAX_AGE_HOURS = 24;

/** Processing jobs one pass may start (each buffers a whole recording on a 2 GB machine); the rest wait for the orphan sweeper. */
export const LANDED_MAX_TRIGGERS_PER_PASS = 2;

type LandedObject = { size: number | null } | null | 'unknown';

/** The storage object for a path, null when the listing succeeded and has none, 'unknown' on any listing error. */
async function findAudioObject(filePath: string): Promise<LandedObject> {
  const slash = filePath.lastIndexOf('/');
  const dir = slash >= 0 ? filePath.slice(0, slash) : '';
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const { data, error } = await supabaseAdmin.storage.from(AUDIO_BUCKET()).list(dir, { limit: 10, search: name });
  if (error || !Array.isArray(data)) return 'unknown';
  const hit = (data as Array<{ name?: string; metadata?: { size?: number } | null }>).find((o) => o.name === name);
  if (!hit) return null;
  return { size: typeof hit.metadata?.size === 'number' ? hit.metadata.size : null };
}

/** Returns how many recordings were recovered. Idempotent: the update only matches a row that is still 'uploading'. */
export async function recoverLandedUploads(now: number = Date.now()): Promise<number> {
  const cutoffIso = new Date(now - LANDED_MIN_IDLE_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('recordings')
    .select('id, user_id, file_path, file_size_bytes, created_at')
    .eq('status', 'uploading')
    .is('meeting_id', null)
    .gt('duration_seconds', 0)
    .not('file_path', 'is', null)
    .lt('updated_at', cutoffIso)
    .limit(STUCK_BATCH);
  if (error) {
    console.error(`${TAG} landed-upload scan failed:`, error.message);
    reportLoopScanError(LOOP);
    return 0;
  }
  const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; user_id: string; file_path: string | null; file_size_bytes: number | null; created_at: string }>;
  let recovered = 0;
  let triggered = 0;
  for (const r of rows) {
    if (!r.id || !r.user_id || !r.file_path) continue;
    const obj = await findAudioObject(r.file_path);
    if (obj === null || obj === 'unknown') continue; // no object: pass two handles it; listing error: maybe exists, touch nothing
    // Same 1% rule as complete-upload. A storage PUT is atomic, so a mismatch means this is not the upload the row describes.
    const expected = r.file_size_bytes ?? 0;
    if (expected > 0 && obj.size !== null && Math.abs(obj.size - expected) / expected > 0.01) continue;
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('recordings')
      .update({ status: 'uploaded', file_size_bytes: obj.size ?? r.file_size_bytes, updated_at: new Date(now).toISOString() })
      .eq('id', r.id)
      .eq('status', 'uploading') // a row that moved on in the meantime no longer matches
      .select('id');
    if (updErr) {
      console.error(`${TAG} landed-upload update failed:`, updErr.message);
      reportLoopScanError(LOOP);
      continue;
    }
    if (!Array.isArray(updated) || updated.length === 0) continue;
    recovered++;
    if (triggered < LANDED_MAX_TRIGGERS_PER_PASS && now - new Date(r.created_at).getTime() < LANDED_PROCESS_MAX_AGE_HOURS * 3600 * 1000) {
      triggered++;
      try {
        // Imported lazily: processingService pulls in the STT stack and validates the full server config on load.
        const { triggerProcessing } = await import('./processingService.js');
        await triggerProcessing(r.id, r.user_id);
      } catch (e) {
        console.error(`${TAG} could not start processing for recovered upload ${r.id.slice(0, 8)}:`, e instanceof Error ? e.message : e); // orphan sweeper picks the 'uploaded' row up
      }
    }
  }
  if (recovered > 0) console.log(`${TAG} recovered ${recovered} upload(s) whose audio landed but complete-upload never succeeded`);
  return recovered;
}

export function startAbandonedUploadSweepLoop(): void {
  registerLoop(LOOP, ABANDONED_SCAN_INTERVAL_MS);
  const pass = async () => (await sweepAbandonedUploads()) + (await recoverLandedUploads()) + (await sweepStuckUploadsWithDuration());
  void runLoopPass(LOOP, pass);
  setInterval(() => {
    void runLoopPass(LOOP, pass);
  }, ABANDONED_SCAN_INTERVAL_MS);
  console.log(`${TAG} loop started (interval=${ABANDONED_SCAN_INTERVAL_MS / 60000}min)`);
}
