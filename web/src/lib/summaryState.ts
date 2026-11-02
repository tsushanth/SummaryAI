/**
 * What the Summary tab shows when there is no summary, and the list badge for short / failed-upload recordings.
 * Pure (no runtime imports) so node can load it directly, see scripts/summaryState.test.mjs.
 *
 * The backend sends summary_status / summary_message / summary_min_seconds on GET /recordings/:id. A recording that is too short
 * or has no speech is 'completed' with error_code TOO_SHORT / NO_SPEECH and no summary row. If the fields are missing (older
 * backend), error_code gives the same answer, so the page works either way.
 */

export const DEFAULT_MIN_SUMMARY_SECONDS = 30;
const RECORD_AGAIN = { label: 'Record again', href: '/recordings/new' } as const;

export interface SummaryViewInput {
  status: string;
  error_code?: string | null;
  hasSummary: boolean;
  summary_status?: string;
  summary_min_seconds?: number;
}

export type SummaryView =
  | { kind: 'summary' }
  | { kind: 'processing'; body: string; action?: undefined }
  | { kind: 'empty'; body: string; action?: undefined }
  | { kind: 'too_short' | 'no_speech' | 'failed_upload'; title: string; body: string; action: { label: string; href: string } };

const PROCESSING = ['pending', 'uploading', 'uploaded', 'transcribing', 'transcribed', 'summarizing'];

export function getSummaryView(input: SummaryViewInput): SummaryView {
  if (input.hasSummary) return { kind: 'summary' };

  const reason =
    input.summary_status === 'too_short' || input.summary_status === 'no_speech' || input.summary_status === 'failed_upload'
      ? input.summary_status
      : input.status === 'completed' && input.error_code === 'TOO_SHORT'
        ? 'too_short'
        : input.status === 'completed' && input.error_code === 'NO_SPEECH'
          ? 'no_speech'
          : input.status === 'failed' && input.error_code === 'FAILED_UPLOAD'
            ? 'failed_upload'
            : null;

  if (reason === 'too_short') {
    const n = input.summary_min_seconds && input.summary_min_seconds > 0 ? input.summary_min_seconds : DEFAULT_MIN_SUMMARY_SECONDS;
    return { kind: 'too_short', title: 'Too short to summarize', body: `Record at least ${n} seconds, or upload audio.`, action: RECORD_AGAIN };
  }
  if (reason === 'no_speech') {
    return {
      kind: 'no_speech',
      title: 'No speech detected',
      body: 'We could not hear anyone in this recording. Check your microphone and try again, or upload audio.',
      action: RECORD_AGAIN,
    };
  }
  if (reason === 'failed_upload') {
    return {
      kind: 'failed_upload',
      title: 'This upload never finished',
      body: 'The recording did not reach our servers. Record again, or upload the audio file.',
      action: RECORD_AGAIN,
    };
  }
  if (PROCESSING.includes(input.status)) {
    return { kind: 'processing', body: 'Summary will appear here once processing is complete.' };
  }
  return { kind: 'empty', body: 'No summary available.' };
}

/** Replacement list badge for rows whose status label ("Completed", "Failed") would mislead. null = keep the normal badge. */
export function recordingBadgeOverride(r: {
  status: string;
  error_code?: string | null;
}): { label: string; tone: 'muted' | 'error' } | null {
  if (r.status === 'completed' && r.error_code === 'TOO_SHORT') return { label: 'Too short', tone: 'muted' };
  if (r.status === 'completed' && r.error_code === 'NO_SPEECH') return { label: 'No speech', tone: 'muted' };
  if (r.status === 'failed' && r.error_code === 'FAILED_UPLOAD') return { label: 'Upload failed', tone: 'error' };
  return null;
}
