/**
 * Fallback recovery for meetings where the Recall `bot.status_change` webhook
 * subscription is missing or pointing at a stale URL. Without those events,
 * `bot_runs.status` stays at `joining` forever and recordings never advance
 * past `status=pending` — even though we DO have all the live transcript
 * segments stored from the (separately-subscribed) transcript webhook.
 *
 * This service runs every 5 min and stitches `live_transcripts` directly into
 * the `transcripts` table for any recording that's been pending too long,
 * marking it `completed` so the iOS / Android clients can show the full
 * transcript via the normal `/recordings/:id?include=transcript` path.
 */

import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { finalizeBotRecording } from './recallService.js';
import type { BotRun, Meeting } from '../types/meetings.js';

const SCAN_INTERVAL_MS = 5 * 60 * 1000;        // 5 min
const MIN_AGE_MS       = 10 * 60 * 1000;       // only touch recordings >10 min old
const PAGE_SIZE        = 500;
const TAG              = '[StuckRecovery]';

// --- bot_runs stuck at `processing` (call_ended/done fired, but the
// `recording.done` / `audio_mixed.done` webhook that finalizes the
// recording never arrived) --------------------------------------------
const BOT_RUN_SCAN_INTERVAL_MS = 3 * 60 * 1000;  // 3 min
const BOT_RUN_MIN_AGE_MS       = 3 * 60 * 1000;  // only touch runs >3 min stale
const BOT_RUN_TAG              = '[BotRecordingReconciler]';

interface LiveSegmentRow {
  segment_text: string | null;
  speaker_name: string | null;
  speaker_id:   string | null;
  is_host:      boolean | null;
  start_timestamp: number | null;
  end_timestamp:   number | null;
}

interface OutSegment {
  id: string;
  speaker_label: string;
  speaker_index: number;
  text: string;
  start_time: number;
  end_time: number;
  confidence: number;
}

export async function fetchAllFinalizedSegments(meetingId: string): Promise<LiveSegmentRow[]> {
  const out: LiveSegmentRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('live_transcripts')
      .select('segment_text, speaker_name, speaker_id, is_host, start_timestamp, end_timestamp')
      .eq('meeting_id', meetingId)
      .eq('is_partial', false)
      .order('start_timestamp', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as LiveSegmentRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

export function stitchSegments(rows: LiveSegmentRow[]): {
  fullText: string;
  segments: OutSegment[];
  wordCount: number;
  speakerCount: number;
  durationSec: number;
} {
  const speakerMap = new Map<string, number>();
  const segments: OutSegment[] = [];
  const textParts: string[] = [];
  let lastSpeaker: string | null = null;

  for (const r of rows) {
    const text = (r.segment_text ?? '').trim();
    if (!text) continue;
    const speaker = r.speaker_name ?? `Speaker ${r.speaker_id ?? 'unknown'}`;
    if (!speakerMap.has(speaker)) speakerMap.set(speaker, speakerMap.size);
    const speakerIndex = speakerMap.get(speaker)!;

    segments.push({
      id: randomUUID(),
      speaker_label: speaker,
      speaker_index: speakerIndex,
      text,
      start_time: Number(r.start_timestamp ?? 0),
      end_time: Number(r.end_timestamp ?? 0),
      confidence: 1.0,
    });

    if (speaker !== lastSpeaker) {
      textParts.push(`\n\n${speaker}: ${text}`);
      lastSpeaker = speaker;
    } else {
      textParts.push(` ${text}`);
    }
  }

  const fullText = textParts.join('').trim();
  const wordCount = segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
  const durationSec = segments.length ? Math.round(segments[segments.length - 1].end_time) : 0;

  return { fullText, segments, wordCount, speakerCount: speakerMap.size, durationSec };
}

/**
 * Stitch live_transcripts into a transcripts row + mark the recording complete.
 * Idempotent: if a transcript already exists for this recording, only the
 * recording status is touched.
 */
export async function stitchStuckRecording(
  recordingId: string,
  meetingId: string
): Promise<{ stitched: boolean; reason?: string; wordCount?: number; speakerCount?: number; durationSec?: number }> {
  const { data: existing } = await supabaseAdmin
    .from('transcripts')
    .select('id')
    .eq('recording_id', recordingId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('recordings')
      .update({ status: 'completed', processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', recordingId);
    return { stitched: false, reason: 'transcript_exists' };
  }

  const rows = await fetchAllFinalizedSegments(meetingId);
  if (!rows.length) return { stitched: false, reason: 'no_live_segments' };

  const result = stitchSegments(rows);
  if (!result.segments.length) return { stitched: false, reason: 'no_segments_after_stitch' };

  const transcriptId = randomUUID();
  const { error: insErr } = await supabaseAdmin
    .from('transcripts')
    .insert({
      id: transcriptId,
      recording_id: recordingId,
      full_text: result.fullText,
      segments: result.segments,
      word_count: result.wordCount,
      speaker_count: result.speakerCount,
      language: 'en',
      transcription_provider: 'recall_realtime',
      transcription_model: 'recall_streaming',
    });
  if (insErr) throw new Error(`transcript insert failed: ${insErr.message}`);

  const { error: updErr } = await supabaseAdmin
    .from('recordings')
    .update({
      status: 'completed',
      word_count: result.wordCount,
      speaker_count: result.speakerCount,
      duration_seconds: result.durationSec,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', recordingId);
  if (updErr) throw new Error(`recording update failed: ${updErr.message}`);

  console.log(
    `${TAG} stitched recording=${recordingId.slice(0, 8)} meeting=${meetingId.slice(0, 8)} ` +
    `words=${result.wordCount} speakers=${result.speakerCount} dur=${result.durationSec}s`
  );

  return {
    stitched: true,
    wordCount: result.wordCount,
    speakerCount: result.speakerCount,
    durationSec: result.durationSec,
  };
}

async function scanAndRecover(): Promise<void> {
  const cutoffIso = new Date(Date.now() - MIN_AGE_MS).toISOString();
  const { data: stuck, error } = await supabaseAdmin
    .from('recordings')
    .select('id, meeting_id, created_at')
    .eq('status', 'pending')
    .eq('source', 'meeting_bot')
    .not('meeting_id', 'is', null)
    .lt('created_at', cutoffIso)
    .limit(50);
  if (error) {
    console.error(`${TAG} scan failed:`, error.message);
    return;
  }
  if (!stuck?.length) return;

  console.log(`${TAG} scanning ${stuck.length} stuck recording(s)`);
  for (const r of stuck) {
    try {
      await stitchStuckRecording(r.id, r.meeting_id as string);
    } catch (e: any) {
      console.error(`${TAG} recover failed for ${r.id.slice(0, 8)}: ${e?.message || e}`);
    }
  }
}

export function startStuckMeetingRecoveryLoop(): void {
  // Run once on boot then every 5 min.
  scanAndRecover().catch(e => console.error(`${TAG} initial scan threw:`, e));
  setInterval(() => {
    scanAndRecover().catch(e => console.error(`${TAG} scan threw:`, e));
  }, SCAN_INTERVAL_MS);
  console.log(`${TAG} loop started (interval=${SCAN_INTERVAL_MS / 1000}s, min_age=${MIN_AGE_MS / 1000}s)`);
}

/**
 * Mark a bot run + meeting + its pending recording as failed. Mirrors
 * webhooks.ts's markBotFailed so a reconciled failure is just as visible
 * (error_message populated, not silently stuck) as a webhook-driven one.
 */
async function markBotRunFailed(
  botRun: BotRun,
  meeting: Meeting,
  errorMessage: string
): Promise<void> {
  await supabaseAdmin
    .from('bot_runs')
    .update({ status: 'failed', error_message: errorMessage })
    .eq('id', botRun.id);

  await supabaseAdmin
    .from('meetings')
    .update({ status: 'failed', error_message: errorMessage })
    .eq('id', meeting.id);

  if (meeting.recording_id) {
    await supabaseAdmin
      .from('recordings')
      .update({ status: 'failed', error_message: errorMessage })
      .eq('id', meeting.recording_id);
  }
}

/**
 * Errors from `finalizeBotRecording` that will fail identically on every
 * retry, because they're about the recording's fixed content, not a
 * transient network/service blip. Retrying these forever just re-downloads
 * the whole recording from Recall each scan for no benefit.
 */
function isPermanentUploadError(message: string): boolean {
  return /exceeded the maximum allowed size/i.test(message);
}

/**
 * Find bot_runs that reached a terminal Recall state (`call_ended`/`done` —
 * i.e. `status: 'processing'`) more than BOT_RUN_MIN_AGE_MS ago, whose
 * linked recording is still `uploading` with no file_path. This is the
 * actual root-cause backstop: today, the ONLY thing that ever advances a
 * bot recording out of `uploading` is the inbound `recording.done` /
 * `audio_mixed.done` webhook from Recall. If that specific event is dropped
 * or never subscribed (distinct from the `bot.*` lifecycle events, which
 * can arrive fine — see the meetings.status='bot_left' update), the
 * recording is stuck forever with no error ever recorded. Recall's
 * `GET /bot/:id` reliably has the finished media at this point (verified:
 * `status_changes` includes `recording_done` and `done`, and
 * `media_shortcuts` already has a `download_url`), so we just poll for it
 * directly instead of waiting on a webhook that may never come.
 */
export async function reconcileStuckBotRecordings(): Promise<void> {
  const cutoffIso = new Date(Date.now() - BOT_RUN_MIN_AGE_MS).toISOString();

  const { data: stuckRuns, error } = await supabaseAdmin
    .from('bot_runs')
    .select('*')
    .eq('status', 'processing')
    .lt('updated_at', cutoffIso)
    .limit(50);

  if (error) {
    console.error(`${BOT_RUN_TAG} scan failed:`, error.message);
    return;
  }
  if (!stuckRuns?.length) return;

  console.log(`${BOT_RUN_TAG} scanning ${stuckRuns.length} bot run(s) stuck in 'processing'`);

  for (const botRun of stuckRuns as BotRun[]) {
    try {
      const { data: meeting, error: meetingError } = await supabaseAdmin
        .from('meetings')
        .select('*')
        .eq('id', botRun.meeting_id)
        .single();

      if (meetingError || !meeting) {
        console.error(`${BOT_RUN_TAG} meeting not found for bot run ${botRun.id}`);
        continue;
      }

      const typedMeeting = meeting as Meeting;

      if (!typedMeeting.recording_id) {
        continue;
      }

      const { data: recording, error: recordingError } = await supabaseAdmin
        .from('recordings')
        .select('id, status, file_path')
        .eq('id', typedMeeting.recording_id)
        .single();

      if (recordingError || !recording) {
        continue;
      }

      // Already finalized (webhook arrived late, or a previous reconcile
      // pass already handled it) or not the failure mode we handle here.
      if (recording.status !== 'uploading' || recording.file_path) {
        continue;
      }

      console.log(`${BOT_RUN_TAG} recovering bot_run=${botRun.id.slice(0, 8)} recording=${recording.id.slice(0, 8)} (recording.done webhook never arrived)`);

      const result = await finalizeBotRecording(botRun, typedMeeting);

      if (result.outcome === 'no_media') {
        await markBotRunFailed(botRun, typedMeeting, 'No recording URL available (reconciled after missing webhook)');
        console.error(`${BOT_RUN_TAG} no media available for bot_run=${botRun.id.slice(0, 8)}`);
      } else {
        console.log(`${BOT_RUN_TAG} recovered recording=${result.recordingId} for bot_run=${botRun.id.slice(0, 8)}`);
      }
    } catch (e: any) {
      const message = e?.message || String(e);
      console.error(`${BOT_RUN_TAG} recover failed for bot_run=${botRun.id.slice(0, 8)}: ${message}`);

      if (isPermanentUploadError(message)) {
        // Retrying this would just re-download the whole recording from
        // Recall and hit the same rejection every scan forever, so stop
        // digging instead of leaving status as 'processing' and (per below)
        // treating it as transient.
        const meetingForFailure = (await supabaseAdmin
          .from('meetings')
          .select('*')
          .eq('id', botRun.meeting_id)
          .single()).data as Meeting | null;
        if (meetingForFailure) {
          await markBotRunFailed(botRun, meetingForFailure, `Recording could not be stored: ${message}`);
        }
      }
      // Otherwise leave status as 'processing' so the next scan retries;
      // bot_runs has no separate retry counter here, so we log loudly
      // instead of marking it failed on a single transient error (network
      // blip, S3 hiccup, etc).
    }
  }
}

export function startBotRecordingReconcilerLoop(): void {
  reconcileStuckBotRecordings().catch(e => console.error(`${BOT_RUN_TAG} initial scan threw:`, e));
  setInterval(() => {
    reconcileStuckBotRecordings().catch(e => console.error(`${BOT_RUN_TAG} scan threw:`, e));
  }, BOT_RUN_SCAN_INTERVAL_MS);
  console.log(`${BOT_RUN_TAG} loop started (interval=${BOT_RUN_SCAN_INTERVAL_MS / 1000}s, min_age=${BOT_RUN_MIN_AGE_MS / 1000}s)`);
}
