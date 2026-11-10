/**
 * Small pure helpers for the New Recording page (no imports, so node loads this directly: scripts/newRecordingForm.test.mjs).
 *
 * Before: "Create Recording" stayed disabled until a title was typed, with no default and no message saying why, so a
 * finished recording looked stuck. Now a blank title falls back to a dated default, and a disabled button says what is missing.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Recording Nov 5, 3:42 PM" in the viewer's local time. Built by hand so the text does not vary with the ICU build. */
export function defaultRecordingTitle(now: Date = new Date()): string {
  const h24 = now.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `Recording ${MONTHS[now.getMonth()]} ${now.getDate()}, ${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** The title to send: what the user typed, else the default. Never empty. */
export function resolveRecordingTitle(typed: string, fallback: string): string {
  return typed.trim() || fallback.trim() || defaultRecordingTitle();
}

export type NewRecordingMode = 'record' | 'upload';

/** Why the submit button is disabled, or null when it is enabled / busy. Shown under the button. */
export function submitBlockedReason(input: {
  mode: NewRecordingMode;
  hasAudio: boolean;
  isRecording: boolean;
  isSubmitting: boolean;
}): string | null {
  if (input.isSubmitting) return null;
  if (input.mode === 'record') {
    if (input.isRecording) return 'Stop the recording to continue.';
    if (!input.hasAudio) return 'Record something first, then you can create the recording.';
    return null;
  }
  return input.hasAudio ? null : 'Choose an audio file first, then you can create the recording.';
}

/** Shown near the recorder. The backend skips the summary for clips under about 30 s / 25 words (it still keeps the transcript). */
export const RECORDING_MINIMUM_HINT =
  'To get a summary, speak for at least 30 seconds (about 25 words). Shorter clips are transcribed but not summarized.';
