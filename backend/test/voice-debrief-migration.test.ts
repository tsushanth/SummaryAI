import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', 'supabase');
const up = join(root, 'migrations', '028_voice_debrief.sql');
const down = join(root, 'rollbacks', '028_voice_debrief_down.sql');
const strip = (s: string) => s.replace(/--.*$/gm, '').toLowerCase();

describe('028_voice_debrief migration files', () => {
  it('exist', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });
  it('is additive: nullable or defaulted columns, no new tables, no drops, no grants', () => {
    const sql = strip(readFileSync(up, 'utf8'));
    expect(sql).toMatch(/add column if not exists source text not null default 'manual'/);
    expect(sql).toMatch(/add column if not exists summary_item_key text(?!\s+not null)/);
    expect(sql).toMatch(/alter table summaries\s+add column if not exists decisions jsonb/);
    expect(sql).not.toMatch(/create table|grant |drop column|drop table/);
  });
  it('rollback removes what was added, idempotently', () => {
    const sql = strip(readFileSync(down, 'utf8'));
    for (const c of ['summary_item_key', 'source', 'decisions']) expect(sql).toMatch(new RegExp(`drop column if exists ${c}`));
    expect(sql).toMatch(/drop index if exists idx_todos_user_summary_item_key/);
  });
});
