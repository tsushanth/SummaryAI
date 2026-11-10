import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const SECRET = 'sink-secret-for-tests';
const OLD_SECRET = 'previous-sink-secret';
const REF = '3f2b8c1e-aaaa-4bbb-8ccc-0123456789ab';

// ---- supabase fake: bot_runs lookup + live_transcripts upsert ----
const state = {
  botRun: null as any,
  botError: null as any,
  upsertError: null as any,
  stored: new Map<string, any>(), // source_key -> row (unique index semantics)
  lookups: [] as Array<[string, string]>,
  upserts: [] as Array<{ rows: any[]; opts: any }>,
};
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'bot_runs') {
        const q: any = {};
        q.select = vi.fn(() => q);
        q.eq = vi.fn((col: string, val: string) => { state.lookups.push([col, val]); return q; });
        q.maybeSingle = vi.fn(async () => ({ data: state.botRun, error: state.botError }));
        q.single = q.maybeSingle;
        return q;
      }
      if (table === 'live_transcripts') {
        return {
          upsert: vi.fn((rows: any[], opts: any) => {
            state.upserts.push({ rows, opts });
            return {
              select: vi.fn(async () => {
                if (state.upsertError) return { data: null, error: state.upsertError };
                const inserted: any[] = [];
                for (const r of rows) {
                  if (state.stored.has(r.source_key)) continue; // ON CONFLICT DO NOTHING
                  state.stored.set(r.source_key, r);
                  inserted.push({ id: `id-${state.stored.size}`, source_key: r.source_key });
                }
                return { data: inserted, error: null };
              }),
            };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  },
}));
const handleLive = vi.fn(async (_botId: string, _segments: any[]) => ({ handled: true }));
vi.mock('../src/services/voiceAssistant/manager.js', () => ({ getVoiceAssistantManager: () => ({ handleLive }) }));
const queueInsightGeneration = vi.fn(async () => {});
vi.mock('../src/services/liveInsightsService.js', () => ({ queueInsightGeneration }));

const { liveSegmentsRouter, liveSegmentsBodyParser, signLiveSegments } = await import('../src/routes/liveSegments.js');

let server: Server;
let base: string;
let clock = 1_800_000_000;
let envBackup: Record<string, string | undefined> = {};

async function start(env: Record<string, string | undefined> = { LIVE_STT_SHARED_SECRET: SECRET }) {
  for (const k of ['LIVE_STT_SHARED_SECRET', 'LIVE_STT_RATE_LIMIT_PER_MIN', 'LIVE_STT_REF_RATE_LIMIT_PER_MIN']) { envBackup[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  const app = express();
  app.use('/internal/live-segments', liveSegmentsBodyParser);
  app.use(express.json({ limit: '10mb' })); // same order as index.ts
  app.use('/internal/live-segments', liveSegmentsRouter({ nowSec: () => clock }));
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/live-segments`;
}

const seg = (n: number, over: Record<string, unknown> = {}) => ({
  key: `sess1:${n}`, seq: n, segment_text: `hello number ${n}`, speaker_id: '2', speaker_name: 'Ada', is_host: false,
  start_timestamp: n * 2, end_timestamp: n * 2 + 1.5,
  words: [{ text: 'hello', start_timestamp: { relative: n * 2 }, end_timestamp: { relative: n * 2 + 0.5 } }],
  is_partial: false, language: 'en', ...over,
});
const payload = (segments: any[], over: Record<string, unknown> = {}) => ({ v: 1, botId: 'recall-bot-1', ref: REF, sessionId: 'sess1', segments, ...over });

async function post(body: unknown, opts: { secret?: string; ts?: number; sig?: string | null; rawBody?: string; headers?: Record<string, string> } = {}) {
  const rawBody = opts.rawBody ?? JSON.stringify(body);
  const ts = String(opts.ts ?? clock);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-mm-timestamp': ts, ...opts.headers };
  if (opts.sig !== null) headers['x-mm-signature'] = opts.sig ?? signLiveSegments(opts.secret ?? SECRET, ts, rawBody);
  const res = await fetch(base, { method: 'POST', headers, body: rawBody });
  let json: any = null;
  try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json, res };
}

beforeEach(() => {
  state.botRun = { id: 'run-1', meeting_id: 'meet-1', user_id: 'user-1', live_stt_provider: 'soniox', recall_bot_id: 'recall-bot-1' };
  state.botError = null;
  state.upsertError = null;
  state.stored.clear();
  state.lookups.length = 0;
  state.upserts.length = 0;
  queueInsightGeneration.mockClear();
  envBackup = {};
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await new Promise((r) => server?.close(r));
  for (const [k, v] of Object.entries(envBackup)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.restoreAllMocks();
});

describe('signature (x-mm-signature = v1=hex(HMAC-SHA256(secret, "<ts>.<rawBody>")))', () => {
  it('accepts a correctly signed request', async () => {
    await start();
    const r = await post(payload([seg(0)]));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, inserted: 1, duplicates: 0 });
  });
  it('matches the live-stt service signing format exactly', async () => {
    await start();
    const body = JSON.stringify(payload([seg(0)]));
    const sig = 'v1=' + createHmac('sha256', SECRET).update(`${clock}.${body}`).digest('hex');
    expect((await post(null, { rawBody: body, sig })).status).toBe(200);
  });
  it.each([
    ['wrong secret', { secret: 'nope' }],
    ['missing signature', { sig: null }],
    ['garbage signature', { sig: 'v1=zz' }],
    ['no v1 prefix', { sig: createHmac('sha256', SECRET).update(`${clock}.x`).digest('hex') }],
    ['replay: timestamp 6 minutes old', { ts: clock - 360 }],
    ['replay: timestamp 6 minutes in the future', { ts: clock + 360 }],
  ])('401 on %s, and nothing is looked up or written', async (_n, o) => {
    await start();
    const r = await post(payload([seg(0)]), o as any);
    expect(r.status).toBe(401);
    expect(state.lookups).toHaveLength(0);
    expect(state.upserts).toHaveLength(0);
  });
  it('401 on a non-numeric timestamp', async () => {
    await start();
    const body = JSON.stringify(payload([seg(0)]));
    const r = await post(null, { rawBody: body, headers: { 'x-mm-timestamp': 'abc' }, sig: signLiveSegments(SECRET, 'abc', body) });
    expect(r.status).toBe(401);
  });
  it('a body altered after signing is rejected (signature covers the raw bytes)', async () => {
    await start();
    const body = JSON.stringify(payload([seg(0)]));
    const sig = signLiveSegments(SECRET, String(clock), body);
    const tampered = body.replace('hello number 0', 'evil number 0');
    expect((await post(null, { rawBody: tampered, sig })).status).toBe(401);
  });
  it('re-serialised (pretty-printed) JSON with the signature of the compact form is rejected', async () => {
    await start();
    const compact = JSON.stringify(payload([seg(0)]));
    const sig = signLiveSegments(SECRET, String(clock), compact);
    expect((await post(null, { rawBody: JSON.stringify(JSON.parse(compact), null, 2), sig })).status).toBe(401);
  });
  it('accepts either secret in a comma separated list (rotation)', async () => {
    await start({ LIVE_STT_SHARED_SECRET: `${SECRET},${OLD_SECRET}` });
    expect((await post(payload([seg(0)]), { secret: OLD_SECRET })).status).toBe(200);
    expect((await post(payload([seg(1)]), { secret: SECRET })).status).toBe(200);
  });
  it('is disabled (404, like an unknown route) when LIVE_STT_SHARED_SECRET is unset, even with a "valid" signature of the empty secret', async () => {
    await start({});
    const r = await post(payload([seg(0)]), { secret: '' });
    expect(r.status).toBe(404);
    expect(state.upserts).toHaveLength(0);
  });
  it('the 401 body does not say which check failed', async () => {
    await start();
    const a = await post(payload([seg(0)]), { secret: 'bad' });
    const b = await post(payload([seg(0)]), { ts: clock - 9999 });
    expect(a.body).toEqual(b.body);
  });
});

describe('schema validation (400, nothing written)', () => {
  const bad: Array<[string, any]> = [
    ['wrong version', payload([seg(0)], { v: 2 })],
    ['missing ref', (() => { const p: any = payload([seg(0)]); delete p.ref; return p; })()],
    ['ref with illegal characters', payload([seg(0)], { ref: 'a b/../c' })],
    ['ref too short', payload([seg(0)], { ref: 'abc' })],
    ['no segments', payload([])],
    ['more than 100 segments', payload(Array.from({ length: 101 }, (_, i) => seg(i)))],
    ['segments not an array', payload([seg(0)], { segments: seg(0) })],
    ['unknown top-level key', payload([seg(0)], { extra: 1 })],
    ['unknown segment key', payload([seg(0, { admin: true })])],
    ['empty text', payload([seg(0, { segment_text: '   ' })])],
    ['text over 10k chars', payload([seg(0, { segment_text: 'a'.repeat(10001) })])],
    ['text not a string', payload([seg(0, { segment_text: 5 })])],
    ['missing key', payload([seg(0, { key: undefined })])],
    ['negative start', payload([seg(0, { start_timestamp: -1 })])],
    ['end before start', payload([seg(0, { start_timestamp: 10, end_timestamp: 5 })])],
    ['NaN-like start (string)', payload([seg(0, { start_timestamp: '3' })])],
    ['absurd offset', payload([seg(0, { start_timestamp: 1e9, end_timestamp: 1e9 + 1 })])],
    ['partial segment', payload([seg(0, { is_partial: true })])],
    ['is_final false', payload([seg(0, { is_final: false })])],
    ['speaker name over 200 chars', payload([seg(0, { speaker_name: 'x'.repeat(201) })])],
    ['is_host not boolean', payload([seg(0, { is_host: 'yes' })])],
    ['language too long', payload([seg(0, { language: 'x'.repeat(40) })])],
    ['words malformed', payload([seg(0, { words: [{ text: 1 }] })])],
    ['words over 2000', payload([seg(0, { words: Array.from({ length: 2001 }, () => ({ text: 'a', start_timestamp: { relative: 0 }, end_timestamp: { relative: 0 } })) })])],
    ['duplicate keys within one request', payload([seg(0), seg(0)])],
  ];
  it.each(bad)('400 on %s', async (_n, body) => {
    await start();
    const r = await post(body);
    expect(r.status).toBe(400);
    expect(state.upserts).toHaveLength(0);
  });
  it('400 on non-JSON that is correctly signed', async () => {
    await start();
    const raw = 'not json {';
    expect((await post(null, { rawBody: raw })).status).toBe(400);
  });
  it('accepts is_final true, null/absent language and null botId', async () => {
    await start();
    const r = await post(payload([seg(0, { is_final: true, language: undefined })], { botId: null }));
    expect(r.status).toBe(200);
  });
  it('error bodies never echo the submitted text or speaker names', async () => {
    await start();
    const r = await post(payload([seg(0, { segment_text: 'SECRET-MEETING-WORDS', start_timestamp: -5 })]));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('SECRET-MEETING-WORDS');
  });
});

describe('size limits', () => {
  it('413 for a body over 512 KB, before any signature work or DB access', async () => {
    await start();
    const big = JSON.stringify(payload([seg(0, { segment_text: 'a'.repeat(600_000) })]));
    const r = await post(null, { rawBody: big });
    expect(r.status).toBe(413);
    expect(state.lookups).toHaveLength(0);
  });
  it('a full 100-segment batch of realistic size passes', async () => {
    await start();
    const segs = Array.from({ length: 100 }, (_, i) => seg(i, { segment_text: 'word '.repeat(60).trim() }));
    expect((await post(payload(segs))).status).toBe(200);
  });
});

describe('bot run lookup and row shape', () => {
  it('looks the bot run up by live_stt_ref, not recall_bot_id', async () => {
    await start();
    await post(payload([seg(0)]));
    expect(state.lookups).toEqual([['live_stt_ref', REF]]);
  });
  it('404 for an unknown ref (permanent: the service drops the batch)', async () => {
    await start();
    state.botRun = null;
    const r = await post(payload([seg(0)]));
    expect(r.status).toBe(404);
    expect(state.upserts).toHaveLength(0);
  });
  it('500 (retryable) when the lookup itself errors', async () => {
    await start();
    state.botRun = null;
    state.botError = { message: 'db down' };
    expect((await post(payload([seg(0)]))).status).toBe(500);
  });
  it('404 when the bot run is not a live-stt run (provider recall/null)', async () => {
    await start();
    state.botRun.live_stt_provider = 'recall';
    expect((await post(payload([seg(0)]))).status).toBe(404);
    state.botRun.live_stt_provider = null;
    expect((await post(payload([seg(1)]))).status).toBe(404);
    expect(state.upserts).toHaveLength(0);
  });
  it('writes rows in the same shape webhooks.ts writes for Recall final segments, plus source_key and shadow=false', async () => {
    await start();
    await post(payload([seg(0)]));
    const row = state.upserts[0]!.rows[0];
    expect(row).toEqual({
      meeting_id: 'meet-1', bot_run_id: 'run-1', user_id: 'user-1',
      segment_text: 'hello number 0', speaker_id: '2', speaker_name: 'Ada', is_host: false,
      start_timestamp: 0, end_timestamp: 1.5,
      words: [{ text: 'hello', start_timestamp: { relative: 0 }, end_timestamp: { relative: 0.5 } }],
      is_partial: false,
      source_key: `live:${REF}:sess1:0`,
      shadow: false,
    });
  });
  it('upserts with onConflict source_key + ignoreDuplicates (ON CONFLICT DO NOTHING)', async () => {
    await start();
    await post(payload([seg(0)]));
    expect(state.upserts[0]!.opts).toEqual({ onConflict: 'source_key', ignoreDuplicates: true });
  });
  it('a client cannot choose meeting, user or shadow: those come from the bot run only', async () => {
    await start();
    // strict schema rejects them outright
    expect((await post(payload([seg(0, { meeting_id: 'other' })]))).status).toBe(400);
    expect((await post(payload([seg(0, { shadow: true })]))).status).toBe(400);
  });
});

describe('idempotency', () => {
  it('the same request sent twice (retry after a lost response) stores each segment once', async () => {
    await start();
    const body = payload([seg(0), seg(1)]);
    const a = await post(body);
    const b = await post(body);
    expect(a.body).toMatchObject({ inserted: 2, duplicates: 0 });
    expect(b.body).toMatchObject({ ok: true, inserted: 0, duplicates: 2 });
    expect(state.stored.size).toBe(2);
  });
  it('an overlapping batch (replay of one old + one new segment) inserts only the new one', async () => {
    await start();
    await post(payload([seg(0), seg(1)]));
    const r = await post(payload([seg(1), seg(2)]));
    expect(r.body).toMatchObject({ inserted: 1, duplicates: 1 });
    expect(state.stored.size).toBe(3);
  });
  it('a replayed (old but within window) signed request is harmless', async () => {
    await start();
    const body = JSON.stringify(payload([seg(0)]));
    const sig = signLiveSegments(SECRET, String(clock), body);
    await post(null, { rawBody: body, sig });
    clock += 120;
    const r = await post(null, { rawBody: body, sig, ts: clock - 120 });
    expect(r.status).toBe(200);
    expect(state.stored.size).toBe(1);
  });
  it('the same key under another ref is a different row (namespaced by ref)', async () => {
    await start();
    await post(payload([seg(0)]));
    state.botRun = { ...state.botRun, id: 'run-2' };
    await post(payload([seg(0)], { ref: 'other-ref-0000-1111' }));
    expect(state.stored.size).toBe(2);
  });
  it('500 (so the service retries) when the insert fails', async () => {
    await start();
    state.upsertError = { message: 'boom' };
    expect((await post(payload([seg(0)]))).status).toBe(500);
    expect(queueInsightGeneration).not.toHaveBeenCalled();
  });
});

describe('live insights trigger', () => {
  it('calls queueInsightGeneration(meeting, user) once per request, not once per segment', async () => {
    await start();
    await post(payload([seg(0), seg(1), seg(2)]));
    expect(queueInsightGeneration).toHaveBeenCalledTimes(1);
    expect(queueInsightGeneration).toHaveBeenCalledWith('meet-1', 'user-1');
  });
  it('does not call it when every segment was a duplicate', async () => {
    await start();
    await post(payload([seg(0)]));
    queueInsightGeneration.mockClear();
    await post(payload([seg(0)]));
    expect(queueInsightGeneration).not.toHaveBeenCalled();
  });
  it('a failing insight queue does not fail the request', async () => {
    await start();
    queueInsightGeneration.mockRejectedValueOnce(new Error('llm down'));
    expect((await post(payload([seg(0)]))).status).toBe(200);
  });
});

describe('shadow runs (bot_runs.live_stt_provider = shadow)', () => {
  beforeEach(() => { state.botRun = { id: 'run-1', meeting_id: 'meet-1', user_id: 'user-1', live_stt_provider: 'shadow', recall_bot_id: 'recall-bot-1' }; });
  it('writes shadow=true rows in a separate source_key namespace', async () => {
    await start();
    await post(payload([seg(0)]));
    const row = state.upserts[0]!.rows[0];
    expect(row.shadow).toBe(true);
    expect(row.source_key).toBe(`shadow:${REF}:sess1:0`);
  });
  it('never triggers live insights (they would double-bill and double-post)', async () => {
    await start();
    await post(payload([seg(0)]));
    expect(queueInsightGeneration).not.toHaveBeenCalled();
  });
  it('is idempotent too', async () => {
    await start();
    await post(payload([seg(0)]));
    const r = await post(payload([seg(0)]));
    expect(r.body).toMatchObject({ inserted: 0, duplicates: 1 });
  });
});

describe('rate limiting', () => {
  it('429 with Retry-After once a client exceeds the per-IP budget, before signature work', async () => {
    await start({ LIVE_STT_SHARED_SECRET: SECRET, LIVE_STT_RATE_LIMIT_PER_MIN: '3' });
    for (let i = 0; i < 3; i++) expect((await post(payload([seg(i)]))).status).toBe(200);
    const r = await post(payload([seg(9)]), { secret: 'wrong' });
    expect(r.status).toBe(429);
    expect(r.res.headers.get('retry-after')).toBeTruthy();
  });
  it('per-ref budget: one noisy meeting cannot starve others', async () => {
    await start({ LIVE_STT_SHARED_SECRET: SECRET, LIVE_STT_REF_RATE_LIMIT_PER_MIN: '2' });
    expect((await post(payload([seg(0)]))).status).toBe(200);
    expect((await post(payload([seg(1)]))).status).toBe(200);
    expect((await post(payload([seg(2)]))).status).toBe(429);
    state.botRun = { ...state.botRun, id: 'run-9' };
    expect((await post(payload([seg(0)], { ref: 'another-ref-aaaa-bbbb' }))).status).toBe(200);
  });
});

describe('logging', () => {
  it('never logs the body, segment text, speaker names, secret or signature', async () => {
    await start();
    const logs: string[] = [];
    for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
    await post(payload([seg(0, { segment_text: 'CONFIDENTIAL-PHRASE', speaker_name: 'Zebediah' })]));
    await post(payload([seg(1, { segment_text: 'CONFIDENTIAL-PHRASE-2', start_timestamp: -1 })]));
    await post(payload([seg(2)]), { secret: 'bad-secret-value' });
    const all = logs.join('\n');
    for (const s of ['CONFIDENTIAL-PHRASE', 'Zebediah', SECRET, 'bad-secret-value', 'v1=']) expect(all).not.toContain(s);
  });
});

describe('voice assistant wake source (VOICE_ASSISTANT_WAKE_SOURCE=live_stt)', () => {
  const settle = () => new Promise((r) => setTimeout(r, 30));
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.VOICE_ASSISTANT_WAKE_SOURCE; handleLive.mockClear(); });
  afterEach(() => { if (saved === undefined) delete process.env.VOICE_ASSISTANT_WAKE_SOURCE; else process.env.VOICE_ASSISTANT_WAKE_SOURCE = saved; });

  it('default: nothing is forwarded to the assistant', async () => {
    delete process.env.VOICE_ASSISTANT_WAKE_SOURCE;
    await start();
    expect((await post(payload([seg(0)]))).status).toBe(200);
    await settle();
    expect(handleLive).not.toHaveBeenCalled();
  });

  it('live_stt: newly stored segments go to the assistant of the Recall bot, in seq order; a retried batch is not forwarded again', async () => {
    process.env.VOICE_ASSISTANT_WAKE_SOURCE = 'live_stt';
    await start();
    const body = payload([seg(1, { segment_text: 'second', speaker_name: 'Ada', is_host: true }), seg(0, { segment_text: 'first', speaker_name: '' })]);
    expect((await post(body)).body).toMatchObject({ inserted: 2 });
    await vi.waitFor(() => expect(handleLive).toHaveBeenCalledTimes(1));
    expect(handleLive).toHaveBeenCalledWith('recall-bot-1', [
      { text: 'first', speakerName: null, isHost: false },
      { text: 'second', speakerName: 'Ada', isHost: true },
    ]);
    expect((await post(body)).body).toMatchObject({ inserted: 0, duplicates: 2 });
    await settle();
    expect(handleLive).toHaveBeenCalledTimes(1);
    // a partial overlap forwards only the new one
    expect((await post(payload([seg(1), seg(2, { segment_text: 'third' })]))).body).toMatchObject({ inserted: 1 });
    await vi.waitFor(() => expect(handleLive).toHaveBeenCalledTimes(2));
    expect((handleLive.mock.calls[1] as any[])[1].map((x: any) => x.text)).toEqual(['third']);
  });

  it('live_stt: a bot run without a stored Recall bot id is skipped, and an assistant failure never fails the sink', async () => {
    process.env.VOICE_ASSISTANT_WAKE_SOURCE = 'live_stt';
    await start();
    state.botRun = { ...state.botRun, recall_bot_id: null };
    expect((await post(payload([seg(0)]))).status).toBe(200);
    await settle();
    expect(handleLive).not.toHaveBeenCalled();
    state.botRun = { ...state.botRun, recall_bot_id: 'recall-bot-1' };
    handleLive.mockRejectedValueOnce(new Error('boom'));
    expect((await post(payload([seg(5)]))).status).toBe(200);
    await settle();
    expect(handleLive).toHaveBeenCalledTimes(1);
  });
});
