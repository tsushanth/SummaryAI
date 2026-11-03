import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const up = readFileSync(new URL('../supabase/migrations/025_stt_shadow_runs.sql', import.meta.url), 'utf8');
const down = readFileSync(new URL('../supabase/rollbacks/025_stt_shadow_runs_down.sql', import.meta.url), 'utf8');
const strip = (s: string) => s.replace(/--.*$/gm, '').toLowerCase();

describe('025_stt_shadow_runs migration', () => {
  it('is idempotent', () => {
    expect(strip(up)).toMatch(/create table if not exists stt_shadow_runs/);
    for (const m of strip(up).matchAll(/create (unique )?index (if not exists )?/g)) expect(m[2]).toBeTruthy();
  });
  it('enables RLS and defines no policies (service role only)', () => {
    expect(strip(up)).toMatch(/alter table stt_shadow_runs enable row level security/);
    expect(strip(up)).not.toMatch(/create policy/);
    expect(strip(up)).not.toMatch(/\bgrant\b/);
  });
  it('has no column that can hold transcript text, a file path, a user id or audio', () => {
    const cols = [...strip(up).matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|int|integer|bigint|numeric|timestamptz)/gm)].map((m) => m[1]);
    expect(cols).toEqual(expect.arrayContaining(['recording_id', 'status', 'wer_vs_primary', 'primary_word_count', 'shadow_word_count']));
    for (const banned of ['text_', 'transcript', 'full_text', 'segments', 'file_path', 'user_id', 'audio', 'words', 'title']) {
      expect(cols.filter((c) => c.includes(banned))).toEqual([]);
    }
  });
  it('status values match what the code writes', () => {
    for (const s of ['ok', 'shadow_error', 'shadow_timeout', 'shadow_empty']) expect(strip(up)).toContain(`'${s}'`);
  });
  it('rollback drops the table and is safe to repeat', () => {
    expect(strip(down)).toMatch(/drop table if exists stt_shadow_runs/);
  });
});
