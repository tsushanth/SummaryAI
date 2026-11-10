import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', 'supabase');
const up = join(root, 'migrations', '030_live_stt_fallback.sql');
const down = join(root, 'rollbacks', '030_live_stt_fallback_down.sql');
const strip = (s: string) => s.replace(/--.*$/gm, '').toLowerCase();

describe('030_live_stt_fallback migration files', () => {
  it('exist', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });
  it('adds one nullable jsonb column, idempotently, and nothing else', () => {
    const sql = strip(readFileSync(up, 'utf8'));
    expect(sql).toMatch(/alter table bot_runs\s+add column if not exists live_stt_fallback jsonb\s*;/);
    expect(sql).not.toMatch(/not null|default|drop|delete|update|create index/);
  });
  it('rollback drops only that column, idempotently', () => {
    const sql = strip(readFileSync(down, 'utf8'));
    expect(sql).toMatch(/alter table bot_runs drop column if exists live_stt_fallback/);
    expect(sql).not.toMatch(/drop table|truncate|delete from/);
  });
});
