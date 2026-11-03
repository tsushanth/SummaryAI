/**
 * "Is there enough audio to summarise?" Rules + the additive API fields that describe the answer.
 *
 * Why: 60 of the first 120 summaries ever made were for clips under 30 s, 33 of them with under 10 words; the model
 * wrote plausible filler for them and the user saw it as the product's output. Now such a recording is transcribed
 * (the transcript is kept), no LLM call is made, no `summaries` row is written, and the recording ends as
 *   status 'completed' + error_code 'TOO_SHORT' | 'NO_SPEECH'.
 * The status stays 'completed' on purpose: the Android enum has no other terminal success value (an unknown status string
 * deserialises to null there), 'completed' stops the clients' polling, and orphan recovery only looks at processing states.
 */
import { DEFAULT_RECORDING_LIMITS, type RecordingLimits } from '../config/recordingLimits.js';

export const TOO_SHORT_CODE = 'TOO_SHORT';
export const NO_SPEECH_CODE = 'NO_SPEECH';
export const FAILED_UPLOAD_CODE = 'FAILED_UPLOAD';

export const NO_SPEECH_MESSAGE = 'No speech detected. Check your microphone and try again, or upload audio.';
export const FAILED_UPLOAD_MESSAGE = 'This upload never finished. Record again, or upload the audio file.';

export const TOO_SHORT_MESSAGE = 'Too short to summarize. Say a little more, or upload audio.';
export const tooShortMessage = (_minSeconds?: number) => TOO_SHORT_MESSAGE;

// Scripts the transcription provider returns without spaces between words: a whitespace split sees a whole sentence as one "word".
const UNSPACED = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u0e00-\u0e7f]/g;

/**
 * Words for the length rule. Whitespace tokens, plus about one unit per 2 characters of Chinese / Japanese / Thai,
 * so a 5-minute Mandarin recording is not mistaken for 3 words. Only used for this gate; stored word_count is unchanged.
 */
export function countSpeechUnits(text: string): number {
  if (!text) return 0;
  const unspaced = text.match(UNSPACED)?.length ?? 0;
  const rest = text.replace(UNSPACED, ' ');
  const spaced = rest.split(/\s+/).filter((w) => w.length > 0).length;
  return spaced + Math.ceil(unspaced / 2);
}

export type SummaryEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'no_speech' | 'too_short'; code: string; message: string };

export function evaluateSummaryEligibility(
  input: { durationSeconds: number | null | undefined; wordCount: number; isDocument: boolean },
  limits: RecordingLimits = DEFAULT_RECORDING_LIMITS
): SummaryEligibility {
  // Imported documents have no audio length and are often short on purpose: never gated.
  if (input.isDocument) return { eligible: true };

  if (input.wordCount <= 0) {
    return { eligible: false, reason: 'no_speech', code: NO_SPEECH_CODE, message: NO_SPEECH_MESSAGE };
  }
  // Genuinely thin = too few words, or a short clip that is not dense. A fast 25 s dictation with 80 words is kept.
  const tooFewWords = input.wordCount < limits.minSummaryWords;
  // Unknown or zero duration = no information, so only the word rule applies.
  const hasDuration = typeof input.durationSeconds === 'number' && input.durationSeconds > 0;
  const shortAndThin =
    hasDuration && (input.durationSeconds as number) < limits.minSummarySeconds && input.wordCount < limits.denseWords;
  if (tooFewWords || shortAndThin) {
    return { eligible: false, reason: 'too_short', code: TOO_SHORT_CODE, message: tooShortMessage(limits.minSummarySeconds) };
  }
  return { eligible: true };
}

export type SummaryStatus = 'ready' | 'processing' | 'too_short' | 'no_speech' | 'failed_upload' | 'failed' | 'unavailable';

export interface SummaryState {
  summary_status: SummaryStatus;
  summary_message: string | null;
  summary_min_seconds: number;
}

const PROCESSING = new Set(['pending', 'uploading', 'uploaded', 'transcribing', 'transcribed', 'summarizing']);

/** Additive fields for GET /recordings/:id. `hasSummary` = a summaries row exists (a user can regenerate one for a short clip). */
export function summaryStateFor(
  recording: { status: string; error_code?: string | null },
  hasSummary: boolean,
  limits: RecordingLimits = DEFAULT_RECORDING_LIMITS
): SummaryState {
  const min = limits.minSummarySeconds;
  const out = (summary_status: SummaryStatus, summary_message: string | null = null): SummaryState =>
    ({ summary_status, summary_message, summary_min_seconds: min });

  if (recording.status === 'completed') {
    if (hasSummary) return out('ready');
    if (recording.error_code === TOO_SHORT_CODE) return out('too_short', tooShortMessage(min));
    if (recording.error_code === NO_SPEECH_CODE) return out('no_speech', NO_SPEECH_MESSAGE);
    return out('unavailable');
  }
  if (recording.status === 'failed') {
    return recording.error_code === FAILED_UPLOAD_CODE ? out('failed_upload', FAILED_UPLOAD_MESSAGE) : out('failed');
  }
  if (PROCESSING.has(recording.status)) return out('processing');
  return out('unavailable');
}
