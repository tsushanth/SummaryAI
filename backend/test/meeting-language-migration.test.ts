import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', 'supabase');
const up = join(root, 'migrations', '027_transcription_language.sql');
const down = join(root, 'rollbacks', '027_transcription_language_down.sql');
const strip = (s: string) => s.replace(/--.*$/gm, '').toLowerCase();

describe('027_transcription_language migration files', () => {
  it('exist', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });
  it('adds one nullable text column to meetings and bot_runs, every statement idempotent, no default, no backfill', () => {
    const sql = strip(readFileSync(up, 'utf8'));
    expect(sql).toMatch(/alter table meetings\s+add column if not exists transcription_language text;/);
    expect(sql).toMatch(/alter table bot_runs\s+add column if not exists transcription_language text;/);
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      expect(stmt).toMatch(/if not exists/);
      expect(stmt).not.toMatch(/default|not null|update |delete /);
    }
  });
  it('rollback only drops those columns, idempotently', () => {
    const sql = strip(readFileSync(down, 'utf8'));
    expect(sql).toMatch(/drop column if exists transcription_language/g);
    expect(sql).not.toMatch(/drop table|truncate|delete from/);
  });
});
