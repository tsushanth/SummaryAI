/**
 * Shadow comparison store + row builder. A shadow row holds COUNTS AND METRICS ONLY (word counts, durations, language
 * codes, speaker counts, a WER number, latencies, an error class). No transcript text, no file path, no user id, no
 * audio. The row type is a closed list so adding a text-bearing field is a deliberate, reviewed change.
 */
import { supabaseAdmin } from '../../lib/supabase.js';

export type ShadowStatus = 'ok' | 'shadow_error' | 'shadow_timeout' | 'shadow_empty';

export interface ShadowRunRow {
  recording_id: string | null;
  primary_provider: string;
  primary_model: string;
  shadow_provider: string;
  shadow_model: string;
  status: ShadowStatus;
  error_class: string | null;
  primary_word_count: number;
  shadow_word_count: number | null;
  primary_duration_seconds: number | null;
  shadow_duration_seconds: number | null;
  primary_language: string;
  shadow_language: string | null;
  primary_speaker_count: number;
  shadow_speaker_count: number | null;
  wer_vs_primary: number | null;
  primary_latency_ms: number;
  shadow_latency_ms: number | null;
}

export interface ShadowStore {
  /** Number of shadow rows so far; throws when the table is not readable (migration 025 not applied). */
  count(): Promise<number>;
  insert(row: ShadowRunRow): Promise<void>;
}

export const supabaseShadowStore: ShadowStore = {
  async count() {
    const { count, error } = await supabaseAdmin.from('stt_shadow_runs').select('id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  },
  async insert(row) {
    const { error } = await supabaseAdmin.from('stt_shadow_runs').insert(row);
    if (error) throw new Error(error.message);
  },
};
