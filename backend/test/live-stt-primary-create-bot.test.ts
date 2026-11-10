import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveDb } from './helpers-liveDb.js';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';
process.env.RECALL_API_KEY = 'recall-test-key';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: (t: string) => h.db.from(t) } }));

const KEYS = [
  'LIVE_STT_PROVIDER', 'LIVE_STT_SHADOW', 'LIVE_STT_SHADOW_USER_IDS', 'LIVE_STT_WS_URL', 'LIVE_STT_INGEST_SECRET', 'LIVE_STT_SONIOX_USER_IDS',
  'LIVE_STT_SONIOX_PERCENT', 'LIVE_STT_FALLBACK', 'LIVE_STT_RECALL_HOT_STANDBY', 'LIVE_STT_MAX_CONCURRENT', 'LIVE_STT_DAILY_BLOCK_USD',
  'LIVE_STT_USER_HOURS_BLOCK', 'SERVICE_URL', 'MEETING_BOT_ANNOUNCE',
] as const;
const saved: Record<string, string | undefined> = {};
const SOL = { LIVE_STT_WS_URL: 'wss://mm-live-stt.example.dev', LIVE_STT_INGEST_SECRET: 'ingest-secret-for-tests' };
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return import('../src/services/recallService.js');
}

let sent: any[] = [];
let db: LiveDb;
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  db = new LiveDb(); h.db = db; sent = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'bot_1', status: 'ready', meeting_url: 'x' }), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const hasTranscript = (i = 0) => 'transcript' in sent[i].recording_config;
const activeSoniox = (n: number) => { for (let i = 0; i < n; i++) db.seed('bot_runs', { user_id: 'x', live_stt_provider: 'soniox', status: 'recording', created_at: new Date().toISOString() }); };

describe('createBot: provider selection per user', () => {
  it('auto + allowlist: the owner gets Soniox, everyone else a Recall transcript', async () => {
    const { RecallService } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_USER_IDS: OWNER, ...SOL });
    const a = await RecallService.createBot({ meeting_url: 'u', user_id: OWNER });
    const b = await RecallService.createBot({ meeting_url: 'u', user_id: OTHER });
    expect(a.live_stt).toMatchObject({ provider: 'soniox' });
    expect(hasTranscript(0)).toBe(false);
    expect(b.live_stt).toBeUndefined();
    expect(hasTranscript(1)).toBe(true);
  });
  it('LIVE_STT_PROVIDER=recall overrides the allowlist: the instant rollback', async () => {
    const { RecallService } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_PROVIDER: 'recall', LIVE_STT_SONIOX_USER_IDS: OWNER, LIVE_STT_SONIOX_PERCENT: '100', ...SOL });
    const a = await RecallService.createBot({ meeting_url: 'u', user_id: OWNER });
    expect(a.live_stt).toBeUndefined();
    expect(JSON.stringify(sent[0].recording_config)).not.toContain('audio_mixed_raw');
  });
});

describe('createBot: capacity', () => {
  it('with 3 Soniox meetings already running the 4th gets a Recall-transcript bot, not a bot with no transcript', async () => {
    activeSoniox(3);
    const { RecallService } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_PROVIDER: 'soniox', ...SOL });
    const bot = await RecallService.createBot({ meeting_url: 'u', user_id: OWNER });
    expect(bot.live_stt).toBeUndefined();
    expect(hasTranscript()).toBe(true);
    expect(JSON.stringify(sent[0].recording_config)).not.toContain('audio_mixed_raw');
  });
  it('with 2 running the 3rd still gets Soniox', async () => {
    activeSoniox(2);
    const { RecallService } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_PROVIDER: 'soniox', ...SOL });
    expect((await RecallService.createBot({ meeting_url: 'u', user_id: OWNER })).live_stt).toMatchObject({ provider: 'soniox' });
  });
  it('a failing capacity lookup chooses Recall', async () => {
    db.missing.add('bot_runs.id');
    const { RecallService } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_PROVIDER: 'soniox', ...SOL });
    expect((await RecallService.createBot({ meeting_url: 'u', user_id: OWNER })).live_stt).toBeUndefined();
  });
  it('the default (recall) path never queries the database', async () => {
    const spy = vi.spyOn(db, 'from');
    const { RecallService } = await load({ SERVICE_URL: 'https://svc.example' });
    await RecallService.createBot({ meeting_url: 'u', user_id: OWNER });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('createBot: hot standby', () => {
  const ALLOW = { SERVICE_URL: 'https://svc.example', LIVE_STT_PROVIDER: 'auto', LIVE_STT_SONIOX_USER_IDS: OWNER, ...SOL };
  it('default off: Soniox only, no Recall transcript block, no webhook endpoint', async () => {
    const { RecallService } = await load(ALLOW);
    await RecallService.createBot({ meeting_url: 'u', user_id: OWNER });
    expect(hasTranscript()).toBe(false);
    expect(sent[0].recording_config.realtime_endpoints).toHaveLength(1);
  });
  it('on + allowlisted user: Recall transcript + webhook + audio_mixed_raw + the Soniox websocket', async () => {
    const { RecallService } = await load({ ...ALLOW, LIVE_STT_RECALL_HOT_STANDBY: 'true' });
    const bot = await RecallService.createBot({ meeting_url: 'u', user_id: OWNER });
    expect(bot.live_stt).toMatchObject({ provider: 'soniox' }); // stored as a Soniox-primary run
    const rc = sent[0].recording_config;
    expect(rc.transcript.provider.recallai_streaming).toBeTruthy();
    expect(rc.audio_mixed_raw).toEqual({});
    expect(rc.realtime_endpoints.map((e: any) => e.type)).toEqual(['webhook', 'websocket']);
  });
  it('on, but the user was selected by percentage (not the allowlist): no standby', async () => {
    const { RecallService } = await load({ ...ALLOW, LIVE_STT_RECALL_HOT_STANDBY: 'true', LIVE_STT_SONIOX_PERCENT: '100' });
    await RecallService.createBot({ meeting_url: 'u', user_id: OTHER });
    expect(hasTranscript()).toBe(false);
  });
  it('on, but no SERVICE_URL (no Recall transcript webhook possible): Soniox only', async () => {
    const { RecallService } = await load({ ...ALLOW, SERVICE_URL: '', LIVE_STT_RECALL_HOT_STANDBY: 'true' });
    await RecallService.createBot({ meeting_url: 'u', user_id: OWNER });
    expect(hasTranscript()).toBe(false);
  });
  it('LIVE_STT_FALLBACK=off disables the standby', async () => {
    const { RecallService } = await load({ ...ALLOW, LIVE_STT_RECALL_HOT_STANDBY: 'true', LIVE_STT_FALLBACK: 'off' });
    await RecallService.createBot({ meeting_url: 'u', user_id: OWNER });
    expect(hasTranscript()).toBe(false);
  });
});

describe('createBot: guardrails', () => {
  it('a blocked user gets the AppError and no bot is created at Recall', async () => {
    db.seed('bot_runs', { user_id: OWNER, status: 'completed', live_stt_provider: 'recall', joined_at: new Date(Date.now() - 5 * 3600_000).toISOString(), left_at: new Date(Date.now() - 3600_000).toISOString(), created_at: new Date().toISOString() });
    const { RecallService } = await load({ SERVICE_URL: 'https://svc.example', LIVE_STT_USER_HOURS_BLOCK: '3' });
    await expect(RecallService.createBot({ meeting_url: 'u', user_id: OWNER })).rejects.toMatchObject({ statusCode: 403, code: 'BOT_USER_HOURS_REACHED' });
    expect(sent).toHaveLength(0);
    await expect(RecallService.createBot({ meeting_url: 'u', user_id: OTHER })).resolves.toBeTruthy();
  });
});
