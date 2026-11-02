/**
 * Pure helpers for deleting a recording from the web app. No runtime imports so node can load this file
 * directly (see scripts/recordingDelete.test.mjs).
 */

/** SWR cache keys whose data includes recordings or counts derived from them. */
const RECORDING_KEY_NAMES = ['recordings', 'recording', 'analytics', 'qa-history', 'meetings', 'folders', 'tags', 'weekly-stats'];

/** True for SWR keys that must be refetched after a recording is deleted (list, detail, folder/tag counts, stats). */
export function isRecordingDataKey(key: unknown): boolean {
  const name = Array.isArray(key) ? key[0] : key;
  return typeof name === 'string' && RECORDING_KEY_NAMES.includes(name);
}

/** A meeting-bot recording stays "uploading" for the whole call; deleting it mid-call would orphan the bot run. */
export function canDeleteRecording(recording: { status: string; meeting_id?: string | null }): boolean {
  return !(recording.status === 'uploading' && !!recording.meeting_id);
}

export function deleteConfirmMessage(title: string): string {
  const name = title.trim() ? `"${title.trim()}"` : 'this recording';
  return `Delete ${name}? Its audio, transcript, summary and Q&A history are removed. This cannot be undone.`;
}

export type DeleteResult = { ok: true } | { ok: false; message: string };

/**
 * Delete through the API, then refresh the caches. A failed delete reports the error and refreshes nothing;
 * a failed refresh after a successful delete is not an error (the next poll or focus refetch catches up).
 */
export async function deleteRecordingThenRefresh(
  id: string,
  deps: { remove: (id: string) => Promise<unknown>; refresh: () => Promise<unknown> | unknown }
): Promise<DeleteResult> {
  try {
    await deps.remove(id);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Failed to delete recording' };
  }
  try {
    await deps.refresh();
  } catch {
    // The recording is gone; stale lists correct themselves on the next refetch.
  }
  return { ok: true };
}
