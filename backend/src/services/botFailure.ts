/**
 * Closing out a bot that ended without ever recording (never admitted from the waiting room, lost webhooks, ...).
 * Used by the Recall webhook (new events) and by the bot recording reconciler (runs that are already stuck).
 */
import { supabaseAdmin } from '../lib/supabase.js';
import { reportRecordingFailureById } from '../lib/recordingFailure.js';

/** Older rows are history, not a fresh failure: they are closed without a failure report. */
const REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface FailableRun {
  id: string;
  meeting_id: string;
  created_at?: string | null;
}

function assertOk(result: { error?: { message?: string } | null } | null | undefined, what: string): void {
  if (result?.error) throw new Error(`Failed to update ${what}: ${result.error.message ?? 'unknown'}`);
}

/**
 * Mark the run failed, and with it the meeting and its still-pending recording. Never overwrites a completed row, and leaves
 * the meeting and recording alone when a newer bot run exists for the meeting. The run is written last, so a partial failure
 * is picked up again by the reconciler.
 */
export async function failNeverRecordedRun(
  run: FailableRun,
  meeting: { id: string; recording_id?: string | null },
  code: string,
  runColumns: Record<string, unknown> = {}
): Promise<void> {
  const { data: latest, error: latestError } = await supabaseAdmin
    .from('bot_runs')
    .select('id')
    .eq('meeting_id', run.meeting_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  assertOk({ error: latestError }, 'bot run lookup');
  const superseded = !!latest && (latest as { id: string }).id !== run.id;

  if (!superseded) {
    if (meeting.recording_id) {
      const result = await supabaseAdmin
        .from('recordings')
        .update({ status: 'failed', error_code: code, error_message: code })
        .eq('id', meeting.recording_id)
        .eq('status', 'pending')
        .select('id');
      assertOk(result, 'recording');
      const age = run.created_at ? Date.now() - Date.parse(run.created_at) : 0;
      if (result.data?.length && !(age > REPORT_MAX_AGE_MS)) {
        reportRecordingFailureById(meeting.recording_id, 'BOT_NEVER_RECORDED');
      }
    }
    assertOk(
      await supabaseAdmin
        .from('meetings')
        .update({ status: 'failed', error_message: code })
        .eq('id', meeting.id)
        // Only a meeting still waiting on this bot: not one completed, cancelled or scheduled again since.
        .in('status', ['bot_joining', 'bot_in_meeting', 'bot_left']),
      'meeting'
    );
  }

  assertOk(
    await supabaseAdmin
      .from('bot_runs')
      .update({ ...runColumns, status: 'failed', error_code: code, error_message: code })
      .eq('id', run.id)
      .neq('status', 'completed'),
    'bot run'
  );
}
