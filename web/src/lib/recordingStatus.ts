/**
 * Recording statuses that are still moving, so a detail page should keep polling. Pure (node loads it in
 * scripts/recordingStatus.test.mjs). Mirrors the backend's PROCESSING set in services/shortRecordingGuard.ts.
 *
 * Before: only 'uploaded' / 'transcribing' / 'summarizing' polled, so a page that landed on 'transcribed' (the short step
 * between transcript and summary), 'pending' or 'uploading' stopped refreshing and sat on "processing" until a manual reload.
 */
export const IN_PROGRESS_STATUSES: readonly string[] = [
  'pending',
  'uploading',
  'uploaded',
  'transcribing',
  'transcribed',
  'summarizing',
];

export function isInProgressStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && IN_PROGRESS_STATUSES.includes(status);
}
