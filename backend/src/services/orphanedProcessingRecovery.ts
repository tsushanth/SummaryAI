/**
 * Recovery for recordings whose in-process processing job was killed mid-way
 * (deploy, restart, OOM kill). processRecordingAsync runs inside the Node process, so when the
 * process dies nothing resumes the job and nothing marks it failed: the row stays
 * 'transcribing' / 'summarizing' forever.
 *
 * Every 5 min we look for recordings in a processing state whose updated_at has not moved for
 * ORPHAN_MIN_AGE_MS (the recordings table has an updated_at trigger, so every status change bumps it):
 *   - younger than 24 h and never retried by this mechanism  -> retry ONCE (marker written first)
 *   - already retried, or older than 24 h                    -> mark failed (PROCESSING_INTERRUPTED)
 * Old orphans are never re-processed automatically: that would fire Slack/Notion/webhook
 * integrations long after the meeting.
 *
 * Poison-pill safety (see fly.toml: an OOM-killed recording once looped every 3 min):
 *   - the retry marker (error_code RECOVERY_RETRY_1) is written BEFORE the re-trigger, via a
 *     compare-and-set on updated_at, so a crash during the retry cannot loop and a second
 *     machine cannot double-process;
 *   - at most MAX_ORPHANS_PER_PASS orphans per pass, and at most ONE re-trigger per pass
 *     (triggerProcessing returns immediately and the job runs in the background, so a second
 *     retry would run concurrently with the first); no retry while any job is active in this process;
 *   - a recording whose job is active in this process is never touched.
 */

import { supabaseAdmin } from '../lib/supabase.js';
import { triggerProcessing, getActiveProcessingIds } from './processingService.js';
import { reportRecordingFailure, reportRecordingRetry } from '../lib/recordingFailure.js';

export const ORPHAN_SCAN_INTERVAL_MS = 5 * 60 * 1000;   // 5 min
export const ORPHAN_MIN_AGE_MS       = 45 * 60 * 1000;  // legit processing takes minutes, even for multi-hour audio
export const ORPHAN_MAX_RETRY_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_ORPHANS_PER_PASS    = 2;
export const RETRY_MARKER_PREFIX     = 'RECOVERY_RETRY_';
export const RETRY_MARKER            = `${RETRY_MARKER_PREFIX}1`;
export const INTERRUPTED_CODE        = 'PROCESSING_INTERRUPTED';
export const INTERRUPTED_MESSAGE     = 'Processing was interrupted by a server restart. Tap retry to process it again.';
const ORPHAN_STATUSES = ['transcribing', 'summarizing', 'transcribed', 'uploaded'];
const TAG = '[OrphanRecovery]';

interface OrphanRow {
  id: string;
  user_id: string;
  status: string;
  source: string | null;
  duration_seconds: number | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

const short = (id: string) => id.slice(0, 8);
const meta = (r: OrphanRow) => ({ source: r.source, durationSeconds: r.duration_seconds, stage: r.status });

export async function recoverOrphanedProcessing(now: number = Date.now()): Promise<void> {
  const cutoffIso = new Date(now - ORPHAN_MIN_AGE_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('recordings')
    .select('id, user_id, status, source, duration_seconds, error_code, created_at, updated_at')
    .in('status', ORPHAN_STATUSES)
    .lt('updated_at', cutoffIso)
    .not('file_path', 'is', null)
    .neq('file_path', '')
    .order('updated_at', { ascending: true })
    .limit(MAX_ORPHANS_PER_PASS * 5);
  if (error) {
    console.error(`${TAG} scan failed:`, error.message);
    return;
  }
  if (!data?.length) return;

  const active = getActiveProcessingIds();
  let handled = 0;

  for (const r of data as OrphanRow[]) {
    if (handled >= MAX_ORPHANS_PER_PASS) break;
    const ageMin = Math.round((now - new Date(r.updated_at).getTime()) / 60000);
    const createdAgeMs = now - new Date(r.created_at).getTime();
    const tag = `recording=${short(r.id)} status=${r.status} idle_min=${ageMin}`;

    if (active.has(r.id)) {
      console.log(`${TAG} ${tag} decision=skip_active_in_process`);
      continue;
    }

    const alreadyRetried = (r.error_code ?? '').startsWith(RETRY_MARKER_PREFIX);
    const canRetry = createdAgeMs < ORPHAN_MAX_RETRY_AGE_MS && !alreadyRetried;

    try {
      if (canRetry) {
        // One re-trigger per pass, and never alongside another job in this process.
        if (active.size > 0) {
          console.log(`${TAG} ${tag} decision=defer_retry_other_job_active`);
          continue;
        }
        handled++;
        // Claim + write the retry marker BEFORE re-triggering (compare-and-set on updated_at).
        const claimed = await claim(r, { status: 'uploaded', error_code: RETRY_MARKER, error_message: null });
        if (!claimed) {
          console.log(`${TAG} ${tag} decision=skip_claim_lost`);
          continue;
        }
        await supabaseAdmin.from('transcripts').delete().eq('recording_id', r.id);
        await supabaseAdmin.from('summaries').delete().eq('recording_id', r.id);
        console.log(`${TAG} ${tag} decision=retry marker=${RETRY_MARKER}`);
        reportRecordingRetry(meta(r));
        await triggerProcessing(r.id, r.user_id);
        break; // one re-trigger per pass
      }

      handled++;
      const claimed = await claim(r, {
        status: 'failed',
        error_code: INTERRUPTED_CODE,
        error_message: INTERRUPTED_MESSAGE,
      });
      if (!claimed) {
        console.log(`${TAG} ${tag} decision=skip_claim_lost`);
        continue;
      }
      console.log(`${TAG} ${tag} decision=mark_failed reason=${alreadyRetried ? 'already_retried' : 'older_than_24h'}`);
      reportRecordingFailure(INTERRUPTED_CODE, meta(r));
    } catch (e: any) {
      console.error(`${TAG} ${tag} decision=error message=${e?.message || e}`);
    }
  }
}

/** Compare-and-set: only succeeds if the row still has the status and updated_at we saw. */
async function claim(r: OrphanRow, patch: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('recordings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', r.id)
    .eq('status', r.status)
    .eq('updated_at', r.updated_at)
    .select('id');
  if (error) {
    console.error(`${TAG} recording=${short(r.id)} claim failed: ${error.message}`);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

export function startOrphanedProcessingRecoveryLoop(): void {
  recoverOrphanedProcessing().catch(e => console.error(`${TAG} initial scan threw:`, e));
  setInterval(() => {
    recoverOrphanedProcessing().catch(e => console.error(`${TAG} scan threw:`, e));
  }, ORPHAN_SCAN_INTERVAL_MS);
  console.log(`${TAG} loop started (interval=${ORPHAN_SCAN_INTERVAL_MS / 1000}s, min_idle=${ORPHAN_MIN_AGE_MS / 60000}min, max_per_pass=${MAX_ORPHANS_PER_PASS})`);
}
