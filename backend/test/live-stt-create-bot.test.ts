import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

process.env.NODE_ENV = 'development'; // config rejects 'test'
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';
process.env.RECALL_API_KEY = 'recall-test-key';

const KEYS = ['LIVE_STT_PROVIDER', 'LIVE_STT_SHADOW', 'LIVE_STT_WS_URL', 'LIVE_STT_INGEST_SECRET', 'LIVE_STT_SHARED_SECRET', 'SERVICE_URL', 'MEETING_BOT_ANNOUNCE'] as const;
const saved: Record<string, string | undefined> = {};

async function load(env: Partial<Record<(typeof KEYS)[number], string>> = {}) {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return import('../src/services/recallService.js');
}

let sent: any[] = [];
let raw: string[] = [];
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  sent = [];
  raw = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    raw.push(init.body);
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'bot_1', status: 'ready', meeting_url: 'x' }), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const SOL = { LIVE_STT_WS_URL: 'wss://mm-live-stt.example.dev', LIVE_STT_INGEST_SECRET: 'ingest-secret-for-tests' };
const WEBHOOK_EVENTS = '["transcript.data","transcript.partial_data"]';
const LEAVE = '{"waiting_room_timeout":600,"noone_joined_timeout":300,"everyone_left_timeout":30}';

describe('createBot default (LIVE_STT_PROVIDER unset = recall) is byte-for-byte today\'s request', () => {
  it('realtime (SERVICE_URL set)', async () => {
    const { RecallService } = await load({ SERVICE_URL: 'https://svc.example' });
    await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1' });
    expect(raw[0]).toBe(
      '{"meeting_url":"https://zoom.us/j/1","bot_name":"Meeting Mind","automatic_leave":' + LEAVE +
      ',"recording_config":{"transcript":{"provider":{"recallai_streaming":{"mode":"prioritize_low_latency","language_code":"en"}}},' +
      '"realtime_endpoints":[{"type":"webhook","url":"https://svc.example/v1/webhooks/recall/transcript","events":' + WEBHOOK_EVENTS + '}]}}'
    );
  });
  it('no SERVICE_URL (accuracy mode, no endpoints)', async () => {
    const { RecallService } = await load();
    await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1', join_at: '2026-11-04T10:00:00Z' });
    expect(raw[0]).toBe(
      '{"meeting_url":"https://zoom.us/j/1","bot_name":"Meeting Mind","automatic_leave":' + LEAVE +
      ',"recording_config":{"transcript":{"provider":{"recallai_streaming":{"mode":"prioritize_accuracy","language_code":"en"}}}},"join_at":"2026-11-04T10:00:00Z"}'
    );
  });
  it('ignores the soniox env vars when LIVE_STT_PROVIDER is recall, and returns no live_stt info', async () => {
    const { RecallService, liveSttBotRunColumns } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_PROVIDER: 'recall', ...SOL });
    const bot = await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1' });
    expect(JSON.stringify(sent[0].recording_config)).not.toContain('audio_mixed_raw');
    expect(bot).not.toHaveProperty('live_stt');
    expect(liveSttBotRunColumns(bot)).toEqual({});
  });
  it('an unknown provider value falls back to recall (a typo never changes behaviour)', async () => {
    const { RecallService } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_PROVIDER: 'sonyx', ...SOL });
    await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1' });
    expect(sent[0].recording_config.transcript.provider.recallai_streaming.language_code).toBe('en');
    expect(JSON.stringify(sent[0])).not.toContain('audio_mixed_raw');
  });
});

describe('createBot with LIVE_STT_PROVIDER=soniox', () => {
  it('drops the transcript block, adds audio_mixed_raw and one websocket endpoint with a ref + HMAC token', async () => {
    const { RecallService, liveSttBotRunColumns } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_PROVIDER: 'soniox', ...SOL });
    const bot = await RecallService.createBot({ meeting_url: 'https://zoom.us/j/1' });
    const rc = sent[0].recording_config;
    expect(rc).not.toHaveProperty('transcript');
    expect(rc.audio_mixed_raw).toEqual({});
    expect(rc.realtime_endpoints).toHaveLength(1);
    const ep = rc.realtime_endpoints[0];
    expect(ep.type).toBe('websocket');
    expect(ep.events).toEqual(['audio_mixed_raw.data', 'participant_events.speech_on', 'participant_events.speech_off']);
    const m = /^wss:\/\/mm-live-stt\.example\.dev\/ingest\/([A-Za-z0-9_-]{8,64})\/\?token=([0-9a-f]{64})$/.exec(ep.url);
    expect(m).not.toBeNull(); // trailing slash before '?' is required by Recall
    const [, ref, token] = m!;
    expect(token).toBe(createHmac('sha256', SOL.LIVE_STT_INGEST_SECRET).update(ref!).digest('hex'));
    expect(bot.live_stt).toEqual({ ref, provider: 'soniox' });
    expect(liveSttBotRunColumns(bot)).toEqual({ live_stt_ref: ref, live_stt_provider: 'soniox' });
    // rest of the payload unchanged
    expect(sent[0]).toMatchObject({ meeting_url: 'https://zoom.us/j/1', bot_name: 'Meeting Mind' });
    expect(sent[0].automatic_leave).toEqual({ waiting_room_timeout: 600, noone_joined_timeout: 300, everyone_left_timeout: 30 });
  });
  it('mints a fresh ref per bot and never puts the secret in the request', async () => {
    const { RecallService } = await load({ LIVE_STT_PROVIDER: 'soniox', ...SOL });
    const a = await RecallService.createBot({ meeting_url: 'u' });
    const b = await RecallService.createBot({ meeting_url: 'u' });
    expect(a.live_stt!.ref).not.toBe(b.live_stt!.ref);
    expect(raw.join('')).not.toContain(SOL.LIVE_STT_INGEST_SECRET);
  });
  it('works without SERVICE_URL (no transcript webhook is needed)', async () => {
    const { RecallService } = await load({ LIVE_STT_PROVIDER: 'soniox', ...SOL });
    await RecallService.createBot({ meeting_url: 'u' });
    expect(sent[0].recording_config.realtime_endpoints).toHaveLength(1);
  });
  it.each([
    ['no ws url', { LIVE_STT_INGEST_SECRET: 'x' }],
    ['no ingest secret', { LIVE_STT_WS_URL: 'wss://a.example' }],
    ['non-websocket url', { LIVE_STT_WS_URL: 'https://a.example', LIVE_STT_INGEST_SECRET: 'x' }],
  ])('misconfigured (%s) falls back to Recall\'s own transcript, never a bot with no transcript', async (_n, env) => {
    const { RecallService, liveSttBotRunColumns } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_PROVIDER: 'soniox', ...(env as any) });
    const bot = await RecallService.createBot({ meeting_url: 'u' });
    expect(sent[0].recording_config.transcript.provider.recallai_streaming.language_code).toBe('en');
    expect(JSON.stringify(sent[0])).not.toContain('audio_mixed_raw');
    expect(liveSttBotRunColumns(bot)).toEqual({});
  });
  it('ignores a trailing slash on LIVE_STT_WS_URL', async () => {
    const { RecallService } = await load({ LIVE_STT_PROVIDER: 'soniox', LIVE_STT_WS_URL: 'wss://a.example/', LIVE_STT_INGEST_SECRET: 's' });
    await RecallService.createBot({ meeting_url: 'u' });
    expect(sent[0].recording_config.realtime_endpoints[0].url.startsWith('wss://a.example/ingest/')).toBe(true);
  });
});

describe('createBot with LIVE_STT_SHADOW=true (provider recall)', () => {
  it('keeps Recall\'s transcript + webhook exactly as today and appends the audio websocket endpoint', async () => {
    const { RecallService, liveSttBotRunColumns } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_SHADOW: 'true', ...SOL });
    const bot = await RecallService.createBot({ meeting_url: 'u' });
    const rc = sent[0].recording_config;
    expect(rc.transcript).toEqual({ provider: { recallai_streaming: { mode: 'prioritize_low_latency', language_code: 'en' } } });
    expect(rc.audio_mixed_raw).toEqual({});
    expect(rc.realtime_endpoints).toHaveLength(2);
    expect(rc.realtime_endpoints[0]).toEqual({ type: 'webhook', url: 'https://svc.example/v1/webhooks/recall/transcript', events: ['transcript.data', 'transcript.partial_data'] });
    expect(rc.realtime_endpoints[1].type).toBe('websocket');
    expect(bot.live_stt!.provider).toBe('shadow');
    expect(liveSttBotRunColumns(bot)).toEqual({ live_stt_ref: bot.live_stt!.ref, live_stt_provider: 'shadow' });
  });
  it('shadow misconfigured: request identical to default, no columns', async () => {
    const { RecallService, liveSttBotRunColumns } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_SHADOW: 'true' });
    const bot = await RecallService.createBot({ meeting_url: 'u' });
    expect(JSON.stringify(sent[0])).not.toContain('audio_mixed_raw');
    expect(liveSttBotRunColumns(bot)).toEqual({});
  });
  it('is ignored when the provider is soniox (soniox is already the source of truth)', async () => {
    const { RecallService } = await load({ LIVE_STT_PROVIDER: 'soniox', LIVE_STT_SHADOW: 'true', ...SOL });
    const bot = await RecallService.createBot({ meeting_url: 'u' });
    expect(bot.live_stt!.provider).toBe('soniox');
    expect(sent[0].recording_config).not.toHaveProperty('transcript');
  });
  it('only the exact string true turns it on', async () => {
    const { RecallService } = await load({ LIVE_STT_SHADOW: 'yes', ...SOL });
    await RecallService.createBot({ meeting_url: 'u' });
    expect(JSON.stringify(sent[0])).not.toContain('audio_mixed_raw');
  });
});
