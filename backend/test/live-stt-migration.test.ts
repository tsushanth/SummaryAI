import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', 'supabase');
const up = join(root, 'migrations', '026_live_stt.sql');
const down = join(root, 'rollbacks', '026_live_stt_down.sql');
const strip = (s: string) => s.replace(/--.*$/gm, '').toLowerCase();

describe('026_live_stt migration files', () => {
  it('exist', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });
  it('adds the columns and unique indexes, every statement idempotent', () => {
    const sql = strip(readFileSync(up, 'utf8'));
    expect(sql).toMatch(/alter table live_transcripts\s+add column if not exists source_key text/);
    expect(sql).toMatch(/add column if not exists shadow boolean not null default false/);
    expect(sql).toMatch(/alter table bot_runs\s+add column if not exists live_stt_ref text/);
    expect(sql).toMatch(/add column if not exists live_stt_provider text/);
    expect(sql).toMatch(/create unique index if not exists \w+\s+on live_transcripts \(source_key\)/);
    expect(sql).toMatch(/create unique index if not exists \w+\s+on bot_runs \(live_stt_ref\)/);
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      expect(stmt).toMatch(/if not exists|do \$\$/);
    }
  });
  it('rollback drops what the migration added, idempotently', () => {
    const sql = strip(readFileSync(down, 'utf8'));
    for (const name of ['source_key', 'shadow']) expect(sql).toMatch(new RegExp(`drop column if exists ${name}`));
    for (const name of ['live_stt_ref', 'live_stt_provider']) expect(sql).toMatch(new RegExp(`drop column if exists ${name}`));
    expect(sql).toMatch(/drop index if exists/);
    expect(sql).not.toMatch(/drop table|truncate|delete from/);
  });
});
