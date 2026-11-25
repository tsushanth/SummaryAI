import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseModelJsonArray } from '../src/lib/modelJson.js';

/** Replies claude-haiku-4-5 gave to the production prompts for a made-up transcript (2026-11-25): every one is fenced. */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/live-insights/${name}.txt`, import.meta.url), 'utf8');

const replies: Record<string, { text: string; stop_reason?: string }> = {};
const inserts: unknown[] = [];
let insertError: (payload: any) => { code: string; message: string } | null = () => null;
const alerts: Array<[string, string, Record<string, unknown>]> = [];

vi.mock('../src/config/index.js', () => ({ config: { ANTHROPIC_API_KEY: 'test' } }));
vi.mock('../src/lib/llm.js', () => ({ instrumentAnthropic: (c: any) => c, withFeature: (_n: string, fn: any) => fn() }));
vi.mock('../src/lib/alerts.js', () => ({ reportAlert: (f: string, c: string, ctx: any) => { alerts.push([f, c, ctx ?? {}]); return true; } }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async ({ system }: { system: string }) => {
        const part = system.startsWith('Extract') ? 'keyPoints' : system.startsWith('Based on') ? 'questions'
          : system.startsWith('Analyze') ? 'factChecks' : 'contradictions';
        const r = replies[part] ?? { text: '[]' };
        return { content: [{ type: 'text', text: r.text }], stop_reason: r.stop_reason ?? 'end_turn' };
      },
    };
  },
}));
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const rows: Record<string, unknown[]> = {
        live_transcripts: [{ speaker_name: 'A', segment_text: 'hello', end_timestamp: 12 }],
        recordings: [{ id: 'r1' }],
        transcripts: [{ recording_id: 'r1', full_text: 'past meeting' }],
      };
      const q: any = {};
      for (const m of ['select', 'eq', 'not', 'in', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (res: any, rej: any) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(res, rej);
      q.insert = async (payload: unknown) => {
        const error = insertError(payload);
        if (!error) inserts.push(...(Array.isArray(payload) ? payload : [payload]));
        return { error };
      };
      return q;
    },
  },
}));

const { generateInsightsForMeeting } = await import('../src/services/liveInsightsService.js');
const run = async () => {
  await generateInsightsForMeeting('m1', 'u1');
  await new Promise((r) => setTimeout(r, 10)); // the contradiction check runs after the main insert
};
const stored = (type: string) => (inserts as any[]).filter((r) => r.insight_type === type);

beforeEach(() => {
  inserts.length = 0; alerts.length = 0; insertError = () => null;
  for (const k of Object.keys(replies)) delete replies[k];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('parseModelJsonArray', () => {
  it('reads the fenced replies the production model really sends (a bare JSON.parse does not)', () => {
    for (const name of ['key-points', 'questions', 'fact-checks']) {
      expect(() => JSON.parse(fixture(name))).toThrow();
      const r = parseModelJsonArray(fixture(name));
      expect(r.ok).toBe(true);
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.failed).toBe(0);
    }
  });
  it('plain, empty, wrapped in prose, wrapped in an object, speaker brackets before the array', () => {
    expect(parseModelJsonArray('["a"]').items).toEqual(['a']);
    expect(parseModelJsonArray('```json\n[]\n```')).toEqual({ ok: true, items: [], failed: 0 });
    expect(parseModelJsonArray('Here you go:\n["a", "b"]\nHope this helps.').items).toEqual(['a', 'b']);
    expect(parseModelJsonArray('{"key_points": ["a"]}').items).toEqual(['a']);
    expect(parseModelJsonArray('[Alex]: said this.\n["a"]').items).toEqual(['a']);
  });
  it('keeps the readable elements of a damaged or cut-off array', () => {
    expect(parseModelJsonArray('[{"claim":"a"}, {"claim": nope}, {"claim":"c"}]')).toEqual({ ok: true, items: [{ claim: 'a' }, { claim: 'c' }], failed: 1 });
    expect(parseModelJsonArray('```json\n["one, with a comma and a ] bracket", "two", "thr')).toEqual({ ok: true, items: ['one, with a comma and a ] bracket', 'two'], failed: 1 });
  });
  it('says when nothing can be read', () => {
    expect(parseModelJsonArray('I could not find any key points.').ok).toBe(false);
    expect(parseModelJsonArray('').ok).toBe(false);
    expect(parseModelJsonArray('["cut off before the first element ends').ok).toBe(false);
  });
});

describe('live insights are stored', () => {
  it('stores fenced replies', async () => {
    replies.keyPoints = { text: fixture('key-points') };
    replies.questions = { text: fixture('questions') };
    replies.factChecks = { text: fixture('fact-checks') };
    replies.contradictions = { text: '```json\n[{"type":"contradiction","current":"x","previous":"y","explanation":"x vs y"}]\n```' };
    await run();
    expect(stored('key_point')).toHaveLength(3);
    expect(stored('question')).toHaveLength(2);
    expect(stored('fact_check')).toMatchObject([{ verification_status: 'false', confidence: 0.99 }]);
    expect(stored('contradiction')).toMatchObject([{ content: 'x vs y', context: 'x' }]);
    expect(alerts).toEqual([]);
  });

  it('one unknown status or bad item does not drop the batch, and the bad item is reported', async () => {
    replies.keyPoints = { text: '["good", 42, {"point": "also good"}]' };
    replies.factChecks = { text: '[{"claim":"a","status":"Unverified","confidence":95},{"status":"false"},{"claim":"b","status":"VERIFIED","confidence":0}]' };
    await run();
    expect(stored('key_point').map((r) => r.content)).toEqual(['good', 'also good']);
    expect(stored('fact_check').map((r) => [r.content, r.verification_status, r.confidence])).toEqual([['a', 'unknown', null], ['b', 'verified', 0]]);
    expect(alerts.map(([f, c, ctx]) => [f, c, ctx.part, ctx.rejected])).toEqual(expect.arrayContaining([
      ['live_insights', 'ITEMS_REJECTED', 'key_points', 1], ['live_insights', 'ITEMS_REJECTED', 'fact_checks', 1],
    ]));
  });

  it('an unreadable reply is reported with no transcript or reply text', async () => {
    replies.questions = { text: 'Sorry, here is some prose about Alex.', stop_reason: 'max_tokens' };
    await run();
    expect(alerts).toEqual([['live_insights', 'PARSE_FAILED', { part: 'questions', stop_reason: 'max_tokens' }]]);
  });

  it('an empty reply is not a failure', async () => {
    await run();
    expect(inserts).toEqual([]);
    expect(alerts).toEqual([]);
  });

  it('a rejected batch is retried row by row and reported', async () => {
    replies.keyPoints = { text: '["keep", "bad", "keep too"]' };
    insertError = (p) => (Array.isArray(p) || p.content === 'bad' ? { code: '23514', message: 'check violation' } : null);
    await run();
    expect(stored('key_point').map((r) => r.content)).toEqual(['keep', 'keep too']);
    expect(alerts).toEqual([['live_insights', 'INSERT_PARTLY_FAILED', { code: '23514', failed: 1, rows: 3 }]]);
  });

  it('a dead insert path is reported as failed', async () => {
    replies.keyPoints = { text: '["a"]' };
    insertError = () => ({ code: '42501', message: 'permission denied' });
    await run();
    expect(alerts).toEqual([['live_insights', 'INSERT_FAILED', { code: '42501', failed: 1, rows: 1 }]]);
  });
});
