/**
 * Account deletion helpers.
 *
 * DELETE /api/users/account deletes the user's rows from the database. The recording rows hold the only
 * pointer (`file_path`) to each audio object in storage, so the objects must be removed BEFORE the rows are
 * deleted; once the rows are gone the files can no longer be found.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RemoveAudioOptions {
  /** Recordings read per query. */
  pageSize?: number;
  /** Paths sent per storage `remove` call. */
  batchSize?: number;
}

/**
 * Remove every audio object that belongs to the user's recordings (same bucket and `file_path` values the
 * single-recording delete route uses). Returns the number of paths removed. Throws if the database read or a
 * storage call fails, so the caller can stop before deleting the rows that hold the paths.
 * A path that no longer exists in storage is not an error for Supabase `remove`.
 */
export async function removeUserAudioFiles(
  client: SupabaseClient,
  bucket: string,
  userId: string,
  { pageSize = 1000, batchSize = 100 }: RemoveAudioOptions = {}
): Promise<number> {
  const paths: string[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('recordings')
      .select('id, file_path')
      .eq('user_id', userId)
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to list recordings: ${error.message}`);
    const rows = (data ?? []) as { id: string; file_path: string | null }[];
    for (const row of rows) {
      if (row.file_path) paths.push(row.file_path);
    }
    if (rows.length < pageSize) break;
  }

  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const { error } = await client.storage.from(bucket).remove(batch);
    if (error) throw new Error(`Failed to delete audio files: ${error.message}`);
  }
  return paths.length;
}
