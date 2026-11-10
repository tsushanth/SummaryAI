import { describe, it, expect, vi, beforeEach } from 'vitest';

// getLatestRunInfo: a database without bot_runs.live_stt_fallback (migration 030) answers "missing column" once; the next reads skip that
// select for a few minutes (no extra failing query on every read), then look again so applying the migration needs no restart.
const calls: string[] = [];
let columnExists = false;
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      let cols = '';
      const q: Record<string, unknown> = {
        select: (c: string) => { cols = c; return q; },
        eq: () => q, in: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => {
          calls.push(cols);
          if (cols.includes('live_stt_fallback') && !columnExists) {
            return { data: null, error: { code: '42703', message: 'column bot_runs.live_stt_fallback does not exist' } };
          }
          return { data: { id: 'r1', status: 'recording', live_stt_provider: 'soniox', live_stt_fallback: columnExists ? { v: 1 } : undefined }, error: null };
        },
      };
      return q;
    },
  },
}));

import { clearFallbackColumnMissing, getLatestRunInfo, markFallbackColumnMissing, fallbackColumnKnownMissing } from '../src/services/meetingLanguage.js';

beforeEach(() => { calls.length = 0; columnExists = false; clearFallbackColumnMissing(); });

describe('getLatestRunInfo and the live_stt_fallback column', () => {
  it('remembers a missing column and skips the failing select afterwards', async () => {
    const a = await getLatestRunInfo('m1');
    expect(a?.id).toBe('r1');
    expect(calls.filter((c) => c.includes('live_stt_fallback'))).toHaveLength(1);
    calls.length = 0;
    await getLatestRunInfo('m1');
    expect(calls.filter((c) => c.includes('live_stt_fallback'))).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it('looks again after the recheck window, so applying the migration needs no restart', async () => {
    markFallbackColumnMissing(Date.now() - 6 * 60_000);
    expect(fallbackColumnKnownMissing()).toBe(false);
    columnExists = true;
    const r = await getLatestRunInfo('m1');
    expect(calls[0]).toContain('live_stt_fallback');
    expect(r?.live_stt_fallback).toEqual({ v: 1 });
  });
});
