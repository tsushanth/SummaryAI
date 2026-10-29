/**
 * Signals to the failure reporter when a recording ends up 'failed' (or is auto-retried).
 * Context holds ONLY non-content strings: code, source, audio_minutes, stage. The message is
 * stable per code so the reporter's per-fingerprint dedupe groups repeats. Never pass titles,
 * transcript text, emails or user ids. Fire-and-forget: never throws.
 */
import { supabaseAdmin } from './supabase.js';
import { reportFailure } from './failureReporter.js';

export type RecordingFailureCode =
  | 'PROCESSING_ERROR'
  | 'PROCESSING_INTERRUPTED'
  | 'NO_MEDIA'
  | 'BOT_FATAL'
  | 'RECORDING_PERMISSION_DENIED'
  | 'BOT_RECORDING_FAILED';

export interface RecordingFailureMeta {
  source?: string | null;
  durationSeconds?: number | null;
  stage?: string | null;
}

function buildContext(code: string, meta: RecordingFailureMeta): Record<string, string> {
  return {
    code,
    source: meta.source || 'unknown',
    audio_minutes: meta.durationSeconds ? String(Math.round(meta.durationSeconds / 60)) : 'unknown',
    stage: meta.stage || 'unknown',
  };
}

export function reportRecordingFailure(code: RecordingFailureCode, meta: RecordingFailureMeta = {}): void {
  try {
    reportFailure('recording_failed', new Error(`Recording failed: ${code}`), buildContext(code, meta));
  } catch { /* reporting must never cause a failure of its own */ }
}

export function reportRecordingRetry(meta: RecordingFailureMeta = {}): void {
  try {
    reportFailure(
      'recording_recovery_retry',
      new Error('Recording processing retried after interruption'),
      buildContext('RECOVERY_RETRY_1', meta)
    );
  } catch { /* never throws */ }
}

/** Maps a bot-path error message to a stable code (the message itself is never sent). */
export function botFailureCode(errorMessage: string): RecordingFailureCode {
  return /^No recording URL/i.test(errorMessage) ? 'NO_MEDIA' : 'BOT_RECORDING_FAILED';
}

/** For bot paths that only know the recording id: look up source/duration, then report. Fire-and-forget. */
export function reportRecordingFailureById(recordingId: string, code: RecordingFailureCode): void {
  void (async () => {
    let meta: RecordingFailureMeta = { source: 'meeting_bot' };
    try {
      const { data } = await supabaseAdmin
        .from('recordings')
        .select('source, duration_seconds')
        .eq('id', recordingId)
        .maybeSingle();
      if (data) meta = { source: data.source, durationSeconds: data.duration_seconds };
    } catch { /* report without metadata */ }
    reportRecordingFailure(code, meta);
  })();
}
