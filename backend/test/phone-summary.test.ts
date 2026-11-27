// A phone call is summarised without anything about its own recording (every path that writes about it); every other
// recording gets exactly the prompt it got before. The transcript below is made up.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { fakeWorld, USER, MY_NUMBER, DEST, RE } from './helpers-phone.js';

const PHONE_ID = '11111111-1111-4111-8111-111111111111';
const MEETING_ID = '22222222-2222-4222-8222-222222222222';
const TURNS = [
  '[0:00] Speaker 1: This call is being recorded.',
  '[0:04] Speaker 2: Hi, I am calling about the fence quote for Saturday.',
  '[0:12] Speaker 1: Saturday at nine works. I will send the estimate of four hundred dollars tonight.',
  '[0:21] Speaker 2: Great, I will leave the side gate open for you when you arrive.',
];
const segments = TURNS.map((t, i) => ({ id: `s${i}`, speaker_label: t.includes('Speaker 1') ? 'Speaker 1' : 'Speaker 2', speaker_index: 0, text: t.replace(/^.*?: /, ''), start_time: i * 8, end_time: i * 8 + 7, confidence: 1 }));

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
/** Returns only the columns that were selected, so a route that forgets to load `source` fails here. */
function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let columns: string[] | null = null;
  let patch: Row | null = null;
  let inserted: Row | null = null;
  const run = (): Row[] => {
    if (inserted) { (db[table] ??= []).push(inserted); return [inserted]; }
    const hit = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (patch) { hit.forEach((r) => Object.assign(r, patch)); return hit; }
    return columns ? hit.map((r) => Object.fromEntries(columns!.map((c) => [c, r[c]]))) : hit;
  };
  const one = () => Promise.resolve({ data: run()[0] ?? null, error: null });
  const q: any = {
    select: (c?: string) => { if (c && c !== '*') columns = c.split(',').map((s) => s.trim()); return q; },
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
    order: () => q, limit: () => q,
    update: (p: Row) => { patch = p; return q; },
    insert: (r: Row) => { inserted = r; return q; },
    single: one, maybeSingle: one,
    then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
  };
  return q;
}

const asked: { system: string; user: string }[] = [];
const replies: string[] = [];
const GOOD = JSON.stringify({ summary: 'S', key_points: ['k'], action_items: [], topics: [] });

vi.mock('../src/config/index.js', () => ({
  // The model client is mocked: the job only needs to see that a model is configured.
  config: { NODE_ENV: 'test', STORAGE_BUCKET_AUDIO: 'audio', ANTHROPIC_API_KEY: true, SUMMARY_MODEL: 'm', VOICE_TOOLS_ENABLED: 'true', VOICE_TOOLS_SECRET: 'on', VOICE_TOOLS_USER_IDS: '*' },
}));
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: { from: (t: string) => query(t), storage: { from: () => ({ download: async () => ({ data: new Blob(['audio']), error: null }) }) } },
}));
vi.mock('../src/middleware/auth.js', () => ({ authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'alice' }; next(); } }));
vi.mock('../src/lib/llm.js', () => ({ instrumentAnthropic: <T>(c: T) => c, withFeature: <T>(_n: string, fn: () => T) => fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: async (p: any) => (asked.push({ system: p.system, user: p.messages[0].content }), { content: [{ type: 'text', text: replies.shift() ?? GOOD }], stop_reason: 'end_turn' }) };
  },
}));
vi.mock('../src/services/integrationsService.js', () => ({ dispatchRecordingCompleted: vi.fn() }));
vi.mock('../src/services/stt/index.js', () => ({
  isSttConfigured: () => true,
  getSttMode: () => 'deepgram',
  transcribeAudio: async () => ({
    provider: 'deepgram', model: 'nova', transcript: { segments, fullText: TURNS.join(' '), wordCount: 200, speakerCount: 2, detectedLanguage: 'es', durationSeconds: 180 },
  }),
}));

const { buildSummaryPrompts, PHONE_CALL_NOTE, PHONE_CALL_SOURCE, phoneCallNote } = await import('../src/services/summaryService.js');
const { generateSummary, buildChunkNotesPrompts } = await import('../src/services/summaryGeneration.js');
const { buildDebriefPrompt } = await import('../src/services/voiceTools.js');
const { SUMMARY_TEMPLATE_IDS } = await import('../src/services/summaryTemplates.js');
const { triggerProcessing, getActiveProcessingIds } = await import('../src/services/processingService.js');
const { ingestRecording } = await import('../src/phone/recordings.js');
const { default: intelligence } = await import('../src/routes/intelligence.js');
const { default: voiceTools } = await import('../src/routes/voiceTools.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const OTHERS = [undefined, null, '', 'upload', 'meeting_bot', 'calendar', 'manual', 'phone', 'Phone_Call'];
const ADDED = `\n\n${PHONE_CALL_NOTE}`;
const times = (text: string) => text.split(PHONE_CALL_NOTE).length - 1;

beforeEach(() => {
  asked.length = 0;
  replies.length = 0;
  for (const k of Object.keys(db)) delete db[k];
  db.recordings = [
    { id: PHONE_ID, user_id: 'alice', title: 'Call to a fence company', status: 'completed', source: PHONE_CALL_SOURCE, recording_type: 'meeting', content_type: 'audio/mpeg', file_path: 'alice/a.mp3', duration_seconds: 180, output_language: null, created_at: '2026-11-20T10:00:00Z' },
    { id: MEETING_ID, user_id: 'alice', title: 'Recording policy review', status: 'completed', source: 'meeting_bot', recording_type: 'meeting', content_type: 'audio/mp4', file_path: 'alice/b.m4a', duration_seconds: 180, output_language: null, created_at: '2026-11-20T11:00:00Z' },
  ];
  db.transcripts = [PHONE_ID, MEETING_ID].map((recording_id) => ({ recording_id, full_text: TURNS.join(' '), segments, language: 'es' }));
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('the instruction', () => {
  it('says the notice was played and keeps recording, notice and consent out of every part', () => {
    for (const words of ['notice that the call is being recorded was played', 'That this call is recorded is not part of its content', 'the notice', 'consent', 'summary', 'key points', 'topics', 'open questions', 'action items']) {
      expect(PHONE_CALL_NOTE).toContain(words);
    }
    expect(phoneCallNote(PHONE_CALL_SOURCE)).toBe(ADDED);
    for (const source of OTHERS) expect(phoneCallNote(source)).toBe('');
  });

  it('is the only difference in a phone call\'s prompt, and other recordings are unchanged', () => {
    for (const templateId of SUMMARY_TEMPLATE_IDS) {
      for (const languageName of [null, 'Spanish']) {
        for (const fromNotes of [false, true]) {
          const input = { templateId, transcriptText: TURNS.join('\n\n'), speakers: ['Speaker 1', 'Speaker 2'], languageName, fromNotes };
          const before = buildSummaryPrompts(input);
          for (const source of OTHERS) expect(buildSummaryPrompts({ ...input, source })).toEqual(before);
          const call = buildSummaryPrompts({ ...input, source: PHONE_CALL_SOURCE });
          expect(times(call.user)).toBe(1);
          expect(call.user.replace(ADDED, '')).toBe(before.user);
          expect(call.system).toBe(before.system);
        }
      }
    }
    const chunk = { chunk: TURNS.join('\n\n'), index: 0, total: 2, speakers: ['Speaker 1', 'Speaker 2'], languageName: null };
    for (const source of OTHERS) expect(buildChunkNotesPrompts({ ...chunk, source })).toEqual(buildChunkNotesPrompts(chunk));
    expect(buildChunkNotesPrompts({ ...chunk, source: PHONE_CALL_SOURCE }).user.replace(ADDED, '')).toBe(buildChunkNotesPrompts(chunk).user);
    const debrief = { title: 'T', turns: TURNS };
    for (const source of OTHERS) expect(buildDebriefPrompt({ ...debrief, source })).toEqual(buildDebriefPrompt(debrief));
    expect(buildDebriefPrompt({ ...debrief, source: PHONE_CALL_SOURCE }).user.replace(ADDED, '')).toBe(buildDebriefPrompt(debrief).user);
  });

  it('stays in the retry after an unusable reply', async () => {
    const prompts: string[] = [];
    await generateSummary({ turns: TURNS, speakers: [], source: PHONE_CALL_SOURCE, model: 'm', complete: async ({ user }) => (prompts.push(user), { text: prompts.length === 1 ? 'not json' : GOOD }) });
    expect(prompts.map(times)).toEqual([1, 1]);
  });

  it('is in every chunk and in the merge of a very long call', async () => {
    const calls: { kind: string; user: string }[] = [];
    const turns = Array.from({ length: 300 }, (_, i) => `[${i}:00] Speaker ${1 + (i % 2)}: ${'word '.repeat(120)}`);
    for (const source of [PHONE_CALL_SOURCE, 'upload']) {
      calls.length = 0;
      await generateSummary({ turns, speakers: [], source, model: 'm', complete: async ({ kind, user }) => (calls.push({ kind, user }), { text: GOOD }) });
      expect(calls.filter((c) => c.kind === 'chunk').length).toBeGreaterThan(1);
      expect(calls.filter((c) => c.kind === 'merge')).toHaveLength(1);
      expect(calls.map((c) => times(c.user))).toEqual(calls.map(() => (source === PHONE_CALL_SOURCE ? 1 : 0)));
    }
  });
});

describe('every path that writes about a recording', () => {
  const process = async (id: string) => {
    await triggerProcessing(id, 'alice');
    await vi.waitFor(() => expect(getActiveProcessingIds().size).toBe(0));
  };

  // The first run, reprocessing and both recovery passes all start this same job.
  it('the processing job, first and again', async () => {
    await process(PHONE_ID);
    await process(PHONE_ID);
    expect(asked.map((p) => times(p.user))).toEqual([1, 1]);
    // The language is asked for exactly as before.
    expect(asked[0]!.user).toContain(`topics in Spanish. JSON keys remain in English`);
    asked.length = 0;
    await process(MEETING_ID);
    expect(asked.map((p) => times(p.user))).toEqual([0]);
  });

  const call = async (path: string, body: unknown) => {
    const app = express();
    app.use(express.json());
    app.use('/api', intelligence);
    app.use('/voice', voiceTools);
    app.use(errorHandler as any);
    const server = app.listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return r.status;
    } finally { server.close(); }
  };

  it('regenerating the summary', async () => {
    for (const [id, expected] of [[PHONE_ID, 1], [MEETING_ID, 0]] as const) {
      asked.length = 0;
      expect(await call(`/api/recordings/${id}/regenerate-summary`, { template: 'sales_call' })).toBe(200);
      expect(asked.map((p) => times(p.user))).toEqual([expected]);
    }
  });

  it('the decisions and actions debrief', async () => {
    db.transcripts![0]!.segments = db.transcripts![1]!.segments = segments;
    for (const [id, expected] of [[PHONE_ID, 1], [MEETING_ID, 0]] as const) {
      asked.length = 0;
      expect(await call(`/voice/meetings/${id}/debrief`, {})).toBe(200);
      expect(asked.map((p) => times(p.user))).toEqual([expected]);
    }
  });

  it.each([['made from the app', {}], ['answered by the agent', { direction: 'in', agent_id: 'agent-1' }]])(
    'a call %s becomes a recording with the phone source', async (_name, extra) => {
      const w = fakeWorld();
      const id = '33333333-3333-4333-8333-333333333333';
      await w.store.insertCall({ id, user_id: USER, from_number: MY_NUMBER, to_number: DEST, twilio_account: 'phone', twilio_call_sid: 'CAparent', ...extra } as never);
      w.ledger.push({ call_id: id, user_id: USER, state: 'reserved', call_sid: 'CAparent', claimed_at: 'now', notice_served_at: 'now', reserved_seconds: 600, actual_seconds: null });
      expect(await ingestRecording(w.deps, id, { sid: RE(1), callSid: 'CAparent', status: 'completed', durationSeconds: 95 })).toBe('stored');
      expect(w.recordings[0]).toMatchObject({ id, source: PHONE_CALL_SOURCE });
      expect(w.processed).toEqual([id]);
    });
});
