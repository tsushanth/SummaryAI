/**
 * Per-user data isolation: the assistant may only ever read the asking user's OWN meetings.
 * The fake database below executes the filters the production code sends (eq / in / or-ilike / order / limit) against two users'
 * rows, and records every query so the test can also assert HOW the data was reached, not just what came back.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));
vi.mock('../../src/config/index.js', () => ({ config: { ANTHROPIC_API_KEY: 'test', SUMMARY_MODEL: 'claude-haiku-4-5-20251001' } }));
vi.mock('../../src/lib/llm.js', () => ({ instrumentAnthropic: (c: any) => c, withFeature: (_n: string, fn: any) => fn() }));

import { makeFakeDb } from './fakeDb.js';
import { supabaseVoiceData } from '../../src/services/voiceAssistant/data.js';
import { createAnswerer, type CompletionRequest } from '../../src/services/voiceAssistant/agent.js';
import { loadVoiceAssistantConfig } from '../../src/services/voiceAssistant/config.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const rec = (id: string, user: string, title: string, day: string) => ({ id, user_id: user, title, created_at: `${day}T10:00:00Z`, duration_seconds: 1800, status: 'completed' });

const TABLES: Record<string, any[]> = {
  recordings: [
    rec('a-rec-1', A, 'Alpha roadmap review', '2026-10-01'),
    rec('a-rec-2', A, 'Alpha hiring sync', '2026-10-08'),
    rec('b-rec-1', B, 'Zebra acquisition talks', '2026-10-02'),
    rec('b-rec-2', B, 'Zebra layoffs plan', '2026-10-09'),
  ],
  transcripts: [
    { recording_id: 'a-rec-1', full_text: 'Alex: we agreed the roadmap ships in March. Dana owns the beta.' },
    { recording_id: 'a-rec-2', full_text: 'Alex: we will hire two engineers in the spring.' },
    { recording_id: 'b-rec-1', full_text: 'Bella: the ZEBRAPRICE is 40 million and the secretcodeword is Tangerine.' },
    { recording_id: 'b-rec-2', full_text: 'Bella: the layoffs of ZEBRASTAFF start in March, keep secretcodeword quiet.' },
  ],
  summaries: [
    { recording_id: 'a-rec-1', summary: 'Roadmap review: ships in March.', detailed_summary: null, key_points: [], action_items: [], topics: [] },
    { recording_id: 'b-rec-1', summary: 'ZEBRA summary: acquisition at 40 million.', detailed_summary: null, key_points: [], action_items: [], topics: [] },
  ],
};

const fakeDb = () => makeFakeDb(TABLES);

const ALL_B_TEXT = /Zebra|ZEBRA|Tangerine|secretcodeword|Bella|layoffs|acquisition/;

/** What the service itself put into requests: the system prompt and every tool result (not the model's own scripted tool calls). */
const serviceText = (requests: CompletionRequest[]): string => {
  const last = requests[requests.length - 1]!;
  const results = last.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content.filter((c: any) => c.type === 'tool_result').map((c: any) => c.content) : []));
  return JSON.stringify([...requests.map((r) => r.system), results]);
};

describe('VoiceData is bound to one user', () => {
  it('index / list only contain the asking user\'s meetings', async () => {
    const { db } = fakeDb();
    const data = supabaseVoiceData(A, db);
    const idx = await data.index();
    expect(idx.map((m) => m.title).sort()).toEqual(['Alpha hiring sync', 'Alpha roadmap review']);
    expect(JSON.stringify(await data.list({}))).not.toMatch(ALL_B_TEXT);
    const other = supabaseVoiceData(B, fakeDb().db);
    expect((await other.index()).map((m) => m.title).sort()).toEqual(['Zebra acquisition talks', 'Zebra layoffs plan']);
  });

  it('searching for words that exist only in another user\'s transcripts returns nothing', async () => {
    const data = supabaseVoiceData(A, fakeDb().db);
    expect(await data.search('secretcodeword Tangerine')).toEqual([]);
    expect(await data.search('ZEBRAPRICE million')).toEqual([]);
    expect((await data.search('roadmap March')).length).toBeGreaterThan(0);
  });

  it('a made-up or foreign meeting id or key is refused, for summary and transcript sections', async () => {
    const data = supabaseVoiceData(A, fakeDb().db);
    await data.index();
    for (const key of ['b-rec-1', 'b-rec-2', 'm03', 'm99', '../b-rec-1', "m01' or user_id.eq.2", '']) {
      for (const section of ['summary', 'transcript'] as const) {
        const out = await data.get(key, { section });
        expect(out, `${key}/${section}`).toHaveProperty('error');
        expect(JSON.stringify(out)).not.toMatch(ALL_B_TEXT);
      }
    }
    const ok = await data.get('m02', { section: 'transcript' });
    expect(JSON.stringify(ok)).toMatch(/roadmap/);
  });

  it('every query is either filtered by the user or restricted to that user\'s recording ids', async () => {
    const { db, queries } = fakeDb();
    const data = supabaseVoiceData(A, db);
    await data.index(); await data.search('roadmap'); await data.list({ query: 'alpha' });
    await data.get('m01'); await data.get('m01', { section: 'transcript' });
    const aIds = ['a-rec-1', 'a-rec-2'];
    for (const q of queries) {
      if (q.table === 'recordings') expect(q.eq).toContainEqual(['user_id', A]);
      else for (const [, ids] of q.in) ids.forEach((id) => expect(aIds).toContain(id));
      if (q.table !== 'recordings') expect(q.in.length).toBeGreaterThan(0);
    }
    expect(queries.some((q) => q.table === 'transcripts')).toBe(true);
  });

  it('refuses to be built without a user id', () => {
    expect(() => supabaseVoiceData('', fakeDb().db)).toThrow();
  });
});

describe('through the model: nothing of another user reaches a request, even when the model asks for it', () => {
  const cfg = () => loadVoiceAssistantConfig({});

  it('an adversarial tool-calling model gets errors/empties for user B\'s data; no request ever contains it', async () => {
    const { db } = fakeDb();
    const data = supabaseVoiceData(A, db);
    const requests: CompletionRequest[] = [];
    const script = [
      [{ type: 'tool_use', id: 't1', name: 'search_transcripts', input: { query: 'secretcodeword ZEBRAPRICE Tangerine' } }],
      [{ type: 'tool_use', id: 't2', name: 'get_meeting', input: { key: 'b-rec-1', section: 'transcript' } },
       { type: 'tool_use', id: 't3', name: 'get_meeting', input: { key: 'm03', section: 'summary' } },
       { type: 'tool_use', id: 't4', name: 'list_meetings', input: { query: 'zebra' } }],
      [{ type: 'text', text: 'NOT_FOUND: I do not see that in your meetings.' }],
    ];
    let i = 0;
    const answer = createAnswerer(cfg, async (req) => { requests.push(JSON.parse(JSON.stringify(req))); return { content: script[i++]!, usage: { input_tokens: 100, output_tokens: 10 } }; });
    const res = await answer({
      question: 'what is the secret codeword', speakerName: 'Alex Owner', allowHistory: true, ownerName: 'Alex Owner', data,
      liveText: () => 'Alex Owner: hello', recent: [],
    });
    expect(res.found).toBe(false);
    expect(serviceText(requests)).not.toMatch(ALL_B_TEXT);
    // Sanity: user A's own data does reach the model's first request (the index).
    expect(JSON.stringify(requests[0])).toMatch(/Alpha roadmap review/);
  });

  it('a speaker who is not the owner gets no history tools and no index at all', async () => {
    const { db, queries } = fakeDb();
    const data = supabaseVoiceData(A, db);
    const requests: CompletionRequest[] = [];
    const answer = createAnswerer(cfg, async (req) => {
      requests.push(JSON.parse(JSON.stringify(req)));
      if (requests.length === 1) return { content: [{ type: 'tool_use', id: 'x', name: 'search_transcripts', input: { query: 'roadmap' } }], usage: {} };
      return { content: [{ type: 'text', text: 'NOT_FOUND: I can only look up past meetings for the account owner.' }], usage: {} };
    });
    const res = await answer({ question: 'what did Alex discuss last week', speakerName: 'Gina Guest', allowHistory: false, data, liveText: () => '(nothing said yet)', recent: [] });
    expect(res.found).toBe(false);
    expect(requests[0]!.tools.map((t: any) => t.name)).toEqual(['get_live_meeting']);
    expect(serviceText(requests)).not.toMatch(/Alpha|ships in March|hire two/);
    expect(queries).toHaveLength(0); // the database was not even touched
  });
});
