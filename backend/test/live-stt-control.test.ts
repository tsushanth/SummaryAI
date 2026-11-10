import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const KEYS = ['LIVE_STT_WS_URL', 'LIVE_STT_CONTROL_SECRET', 'LIVE_STT_SHARED_SECRET'] as const;
const saved: Record<string, string | undefined> = {};
async function load(env: Partial<Record<(typeof KEYS)[number], string>>) {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return { ctl: await import('../src/lib/liveSttControl.js'), lib: await import('../src/lib/liveStt.js') };
}
beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k]; });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('signLiveControl / buildIngestUrl', () => {
  it('signature is v1=HMAC(secret, "control.<ts>.<body>") and differs from the segment-sink signature', async () => {
    const { lib } = await load({});
    const sig = lib.signLiveControl('s3cret', '1800000000', '{"a":1}');
    expect(sig).toBe('v1=' + createHmac('sha256', 's3cret').update('control.1800000000.{"a":1}').digest('hex'));
    expect(sig).not.toBe(lib.signLiveSegments('s3cret', '1800000000', '{"a":1}'));
  });
  it('ingest url: no lang unless a valid code is given', async () => {
    const { lib } = await load({});
    const base = lib.buildIngestUrl('wss://a.example', 'k', 'ref-12345678');
    expect(lib.buildIngestUrl('wss://a.example', 'k', 'ref-12345678', undefined)).toBe(base);
    expect(lib.buildIngestUrl('wss://a.example', 'k', 'ref-12345678', 'fr')).toBe(base + '&lang=fr');
    expect(lib.buildIngestUrl('wss://a.example', 'k', 'ref-12345678', 'fr&x=1')).toBe(base);
    expect(lib.buildIngestUrl('wss://a.example', 'k', 'ref-12345678', '')).toBe(base);
  });
});

describe('liveControlBaseUrl', () => {
  it('wss -> https, ws -> http, rejects anything with a path or another scheme', async () => {
    const { ctl } = await load({});
    expect(ctl.liveControlBaseUrl('wss://mm-live-stt.fly.dev/')).toBe('https://mm-live-stt.fly.dev');
    expect(ctl.liveControlBaseUrl('ws://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(ctl.liveControlBaseUrl('https://x.example')).toBeNull();
    expect(ctl.liveControlBaseUrl('wss://x.example/ingest')).toBeNull();
    expect(ctl.liveControlBaseUrl(undefined)).toBeNull();
  });
});

describe('notifyLiveLanguage', () => {
  const env = { LIVE_STT_WS_URL: 'wss://mm-live-stt.example.dev', LIVE_STT_CONTROL_SECRET: 'control-secret' };
  const reply = (status: number) => vi.fn(async () => new Response('{}', { status }));

  it('posts a signed body to /control/language', async () => {
    const { ctl, lib } = await load(env);
    const f = reply(200);
    const r = await ctl.notifyLiveLanguage('ref-abc-123456', 'es', { fetchImpl: f as any, nowSec: () => 1_800_000_000 });
    expect(r).toEqual({ ok: true, state: 'applied' });
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://mm-live-stt.example.dev/control/language');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"v":1,"ref":"ref-abc-123456","language":"es"}');
    expect(init.headers['x-mm-timestamp']).toBe('1800000000');
    expect(init.headers['x-mm-signature']).toBe(lib.signLiveControl('control-secret', '1800000000', init.body));
  });
  it('falls back to the first LIVE_STT_SHARED_SECRET when no control secret is set', async () => {
    const { ctl, lib } = await load({ LIVE_STT_WS_URL: env.LIVE_STT_WS_URL, LIVE_STT_SHARED_SECRET: 'new-sink, old-sink' });
    const f = reply(200);
    await ctl.notifyLiveLanguage('ref-abc-123456', 'auto', { fetchImpl: f as any, nowSec: () => 5 });
    const init = (f.mock.calls[0] as any)[1];
    expect(init.headers['x-mm-signature']).toBe(lib.signLiveControl('new-sink', '5', init.body));
  });
  it('maps statuses', async () => {
    const { ctl } = await load(env);
    const go = (s: number) => ctl.notifyLiveLanguage('ref-abc-123456', 'es', { fetchImpl: reply(s) as any });
    expect(await go(202)).toEqual({ ok: true, state: 'queued' });
    expect(await go(401)).toEqual({ ok: false, reason: 'unauthorized' });
    expect(await go(404)).toEqual({ ok: false, reason: 'rejected' });
    expect(await go(400)).toEqual({ ok: false, reason: 'rejected' });
    expect(await go(503)).toEqual({ ok: false, reason: 'server_error' });
  });
  it('network error / not configured', async () => {
    const { ctl } = await load(env);
    expect(await ctl.notifyLiveLanguage('r', 'es', { fetchImpl: vi.fn(async () => { throw new Error('boom'); }) as any })).toEqual({ ok: false, reason: 'unreachable' });
    const off = await load({});
    expect(await off.ctl.notifyLiveLanguage('r', 'es', { fetchImpl: reply(200) as any })).toEqual({ ok: false, reason: 'not_configured' });
  });
});
