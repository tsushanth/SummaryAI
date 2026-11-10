import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

process.env.NODE_ENV = 'development'; // config rejects 'test'
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';
process.env.RECALL_API_KEY = 'recall-test-key';

// createBot now counts concurrent Soniox bots (capacity check) through supabaseAdmin: answer "none running".
vi.mock('../src/lib/supabase.js', () => {
  const q: any = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'limit']) q[m] = () => q;
  q.then = (res: any) => Promise.resolve({ data: [], error: null }).then(res);
  return { supabaseAdmin: { from: () => q } };
});

const KEYS = ['LIVE_STT_PROVIDER', 'LIVE_STT_SHADOW', 'LIVE_STT_SHADOW_USER_IDS', 'LIVE_STT_WS_URL', 'LIVE_STT_INGEST_SECRET', 'SERVICE_URL', 'MEETING_BOT_ANNOUNCE', 'RECALL_AUTO_LANGUAGE'] as const;
const saved: Record<string, string | undefined> = {};

async function load(env: Partial<Record<(typeof KEYS)[number], string>> = {}) {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return import('../src/services/recallService.js');
}

let raw: string[] = [];
let sent: any[] = [];
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  raw = []; sent = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
    raw.push(init.body); sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'bot_1', status: 'ready', meeting_url: 'x' }), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const SVC = { SERVICE_URL: 'https://svc.example' };
const SOL = { LIVE_STT_WS_URL: 'wss://mm-live-stt.example.dev', LIVE_STT_INGEST_SECRET: 'ingest-secret-for-tests' };
const provider = (i = 0) => sent[i].recording_config.transcript.provider.recallai_streaming;

describe('Recall path: default body is byte-for-byte unchanged when no language (or auto/en) is given', () => {
  it('no language', async () => {
    const { RecallService } = await load(SVC);
    await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1' });
    const baseline = raw[0];
    for (const lang of ['auto', 'en', undefined]) {
      raw = [];
      await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1', transcription_language: lang });
      expect(raw[0]).toBe(baseline);
    }
    expect(baseline).toContain('"recallai_streaming":{"mode":"prioritize_low_latency","language_code":"en"}');
  });
  it('without SERVICE_URL too', async () => {
    const { RecallService } = await load();
    await RecallService.createBot({ meeting_url: 'u', transcription_language: 'auto' });
    expect(provider()).toEqual({ mode: 'prioritize_accuracy', language_code: 'en' });
  });
});

describe('Recall path: a chosen language', () => {
  it.each(['es', 'fr', 'de', 'ja', 'hi', 'zh', 'he'])('%s -> accuracy mode with that language_code, rest of the body unchanged', async (lang) => {
    const { RecallService } = await load(SVC);
    await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1', transcription_language: lang });
    expect(provider()).toEqual({ mode: 'prioritize_accuracy', language_code: lang });
    expect(sent[0].recording_config.realtime_endpoints).toEqual([{ type: 'webhook', url: 'https://svc.example/v1/webhooks/recall/transcript', events: ['transcript.data', 'transcript.partial_data'] }]);
    expect(sent[0].bot_name).toBe('Meeting Mind');
  });
  it('an unknown code is ignored (never sent to Recall) and falls back to the default block', async () => {
    const { RecallService } = await load(SVC);
    await RecallService.createBot({ meeting_url: 'u', transcription_language: 'klingon' });
    expect(provider()).toEqual({ mode: 'prioritize_low_latency', language_code: 'en' });
  });
  it('RECALL_AUTO_LANGUAGE=detect makes auto use Recall language detection (accuracy mode)', async () => {
    const { RecallService } = await load({ ...SVC, RECALL_AUTO_LANGUAGE: 'detect' });
    await RecallService.createBot({ meeting_url: 'u', transcription_language: 'auto' });
    expect(provider()).toEqual({ mode: 'prioritize_accuracy', language_code: 'auto' });
    raw = []; sent = [];
    await RecallService.createBot({ meeting_url: 'u', transcription_language: 'en' });
    expect(provider()).toEqual({ mode: 'prioritize_low_latency', language_code: 'en' });
  });
});

describe('Soniox live path carries the language in the ingest URL', () => {
  it('no lang parameter for auto/none: URL identical to before', async () => {
    const { RecallService } = await load({ ...SVC, LIVE_STT_PROVIDER: 'soniox', ...SOL });
    await RecallService.createBot({ meeting_url: 'u' });
    await RecallService.createBot({ meeting_url: 'u', transcription_language: 'auto' });
    for (const s of sent) expect(s.recording_config.realtime_endpoints[0].url).toMatch(/^wss:\/\/mm-live-stt\.example\.dev\/ingest\/[A-Za-z0-9_-]{8,64}\/\?token=[0-9a-f]{64}$/);
  });
  it('lang=<code> after the token; the token is still HMAC(secret, ref) only', async () => {
    const { RecallService } = await load({ ...SVC, LIVE_STT_PROVIDER: 'soniox', ...SOL });
    const bot = await RecallService.createBot({ meeting_url: 'u', transcription_language: 'ES-mx' });
    const url = sent[0].recording_config.realtime_endpoints[0].url as string;
    const m = /^wss:\/\/mm-live-stt\.example\.dev\/ingest\/([A-Za-z0-9_-]{8,64})\/\?token=([0-9a-f]{64})&lang=es$/.exec(url);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(createHmac('sha256', SOL.LIVE_STT_INGEST_SECRET).update(m![1]!).digest('hex'));
    expect(bot.live_stt!.ref).toBe(m![1]);
    expect(sent[0].recording_config).not.toHaveProperty('transcript');
  });
  it('shadow: Recall transcript uses the language and the audio endpoint gets the hint too', async () => {
    const { RecallService } = await load({ ...SVC, LIVE_STT_SHADOW: 'true', LIVE_STT_SHADOW_USER_IDS: 'user-owner', ...SOL });
    await RecallService.createBot({ meeting_url: 'u', user_id: 'user-owner', transcription_language: 'fr' });
    expect(provider()).toEqual({ mode: 'prioritize_accuracy', language_code: 'fr' });
    const eps = sent[0].recording_config.realtime_endpoints;
    expect(eps[1].url).toMatch(/&lang=fr$/);
  });
});

describe('bot_runs columns and insert fallback', () => {
  it('transcriptionLanguageColumns: nothing for auto/none, the code otherwise', async () => {
    const { transcriptionLanguageColumns } = await load();
    expect(transcriptionLanguageColumns(undefined)).toEqual({});
    expect(transcriptionLanguageColumns('auto')).toEqual({});
    expect(transcriptionLanguageColumns(null)).toEqual({});
    expect(transcriptionLanguageColumns('fr')).toEqual({ transcription_language: 'fr' });
  });
  it('insertWithOptionalColumn retries without the column when the migration is not applied, and never swallows other errors', async () => {
    const { insertWithOptionalColumn } = await load();
    const calls: any[] = [];
    const mk = (errs: any[]) => ({
      insert: async (row: any) => { calls.push(row); return { error: errs.shift() ?? null }; },
    });
    // column missing (Postgres 42703 or PostgREST schema-cache PGRST204)
    for (const err of [{ code: '42703', message: 'column "transcription_language" of relation "bot_runs" does not exist' }, { code: 'PGRST204', message: "Could not find the 'transcription_language' column of 'bot_runs' in the schema cache" }]) {
      calls.length = 0;
      const r = await insertWithOptionalColumn(mk([err]) as any, { a: 1, transcription_language: 'fr' }, 'transcription_language');
      expect(r.error).toBeNull();
      expect(calls).toEqual([{ a: 1, transcription_language: 'fr' }, { a: 1 }]);
    }
    // unrelated error: returned as is, no retry
    calls.length = 0;
    const r2 = await insertWithOptionalColumn(mk([{ code: '23505', message: 'duplicate key' }]) as any, { a: 1, transcription_language: 'fr' }, 'transcription_language');
    expect(r2.error).toMatchObject({ code: '23505' });
    expect(calls).toHaveLength(1);
    // no column in the row: single call
    calls.length = 0;
    await insertWithOptionalColumn(mk([]) as any, { a: 1 }, 'transcription_language');
    expect(calls).toHaveLength(1);
  });
});
