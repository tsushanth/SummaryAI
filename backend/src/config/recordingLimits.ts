/**
 * Thresholds for short / empty / abandoned recordings. One place, env-overridable (fly secrets / env, then restart).
 * Read through getRecordingLimits() at call time so tests can pass their own env and the main config
 * (which exits the process on a bad env) is not needed to import this.
 *
 *  MIN_SUMMARY_WORDS      fewer transcribed words than this is never summarised (default 25; 0 turns the rule off)
 *  MIN_SUMMARY_SECONDS    audio shorter than this is skipped too, UNLESS it is dense (default 30; 0 turns the rule off)
 *  DENSE_WORDS            a clip shorter than MIN_SUMMARY_SECONDS with at least this many words is still summarised
 *                         (a fast 25 s dictation); default 60
 *  ABANDONED_UPLOAD_HOURS a user upload still 'uploading' with no duration after this long is marked failed (default 6, min 1;
 *                         the signed upload URL lives 1 h, so anything past that cannot still be in flight)
 */
export interface RecordingLimits {
  minSummarySeconds: number;
  minSummaryWords: number;
  denseWords: number;
  abandonedUploadHours: number;
}

export const DEFAULT_RECORDING_LIMITS: RecordingLimits = {
  minSummarySeconds: 30,
  minSummaryWords: 25,
  denseWords: 60,
  abandonedUploadHours: 6,
};

function num(raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export function getRecordingLimits(env: Record<string, string | undefined> = process.env): RecordingLimits {
  return {
    minSummarySeconds: num(env.MIN_SUMMARY_SECONDS, DEFAULT_RECORDING_LIMITS.minSummarySeconds, 0),
    minSummaryWords: num(env.MIN_SUMMARY_WORDS, DEFAULT_RECORDING_LIMITS.minSummaryWords, 0),
    denseWords: num(env.DENSE_WORDS, DEFAULT_RECORDING_LIMITS.denseWords, 0),
    abandonedUploadHours: num(env.ABANDONED_UPLOAD_HOURS, DEFAULT_RECORDING_LIMITS.abandonedUploadHours, 1),
  };
}
