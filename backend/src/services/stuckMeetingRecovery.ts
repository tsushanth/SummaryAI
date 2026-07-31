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

const SCAN_INTERVAL_MS = 5 * 60 * 1000;        // 5 min
const MIN_AGE_MS       = 10 * 60 * 1000;       // only touch recordings >10 min old
const PAGE_SIZE        = 500;
const TAG              = '[StuckRecovery]';

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
