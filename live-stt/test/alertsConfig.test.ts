import { describe, expect, it, vi } from 'vitest';
import { makeWebhookAlert } from '../src/alerts.js';
import { loadConfig } from '../src/config.js';
import { StreamLimiter } from '../src/concurrency.js';
import { MeetingSession } from '../src/session.js';
import { FakeEngine } from './helpers/fakeEngine.js';
import { MemorySink } from './helpers/memorySink.js';

describe('makeWebhookAlert', () => {
  it('posts JSON once per kind per interval and never throws', async () => {
    let now = 0;
    const calls: string[] = [];
    const fetchFn = vi.fn(async (_u: string, init: RequestInit) => { calls.push(String(init.body)); return new Response('ok'); });
    const alert = makeWebhookAlert({ url: 'https://hook.example/x', minIntervalMs: 1000, now: () => now, fetchFn: fetchFn as unknown as typeof fetch });
    alert('soniox_concurrency_429', { ref: 'r1' });
    alert('soniox_concurrency_429', { ref: 'r1' });
    alert('mm_stream_cap', { cap: 3 });
    now = 1500;
    alert('soniox_concurrency_429', { ref: 'r1' });
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[0]!)).toMatchObject({ kind: 'soniox_concurrency_429', ref: 'r1' });
    const bad = makeWebhookAlert({ url: 'https://x', fetchFn: (async () => { throw new Error('down'); }) as unknown as typeof fetch });
    expect(() => bad('live_degraded', {})).not.toThrow();
  });
});

describe('loadConfig', () => {
  const base = { INGEST_TOKEN_SECRETS: 'a, b', SONIOX_API_KEY: 'k', BACKEND_SINK_URL: 'https://b/x', BACKEND_SINK_SECRET: 's' };
  it('defaults: 3 streams, http sink, header auth, endpoint detection on', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ maxStreams: 3, maxSessions: 3, sink: 'http', sonioxAuthMode: 'header', sonioxEndpointDetection: true, ingestSecrets: ['a', 'b'] });
  });
  it('names the missing variable but never echoes values', () => {
    expect(() => loadConfig({ ...base, INGEST_TOKEN_SECRETS: '' })).toThrow(/INGEST_TOKEN_SECRETS/);
    expect(() => loadConfig({ ...base, SONIOX_API_KEY: '' })).toThrow(/SONIOX_API_KEY/);
    expect(() => loadConfig({ ...base, BACKEND_SINK_SECRET: '' })).toThrow(/BACKEND_SINK/);
    try { loadConfig({ ...base, SINK: 'bogus' }); } catch (e) { expect(String(e)).not.toContain('k'.repeat(1) + 'bogus_'); }
  });
  it('requires supabase vars only for the supabase sink', () => {
    expect(() => loadConfig({ INGEST_TOKEN_SECRETS: 'a', SONIOX_API_KEY: 'k', SINK: 'supabase' })).toThrow(/SUPABASE/);
    expect(loadConfig({ INGEST_TOKEN_SECRETS: 'a', SONIOX_API_KEY: 'k', SINK: 'log' }).sink).toBe('log');
  });
});

describe('StreamLimiter + alert hooks in the session', () => {
  it('limits acquisitions and releases', () => {
    const l = new StreamLimiter(2);
    expect([l.acquire(), l.acquire(), l.acquire()]).toEqual([true, true, false]);
    l.release();
    expect(l.available()).toBe(1);
  });
  it('raises soniox_concurrency_429 when Soniox answers 429', async () => {
    vi.useFakeTimers();
    const alerts: string[] = [];
    const engine = new FakeEngine();
    const s = new MeetingSession({ ref: 'r', engine, sink: new MemorySink(), alert: (k) => alerts.push(k) });
    s.handleAudio({ relMs: 0, durMs: 200, pcm: Buffer.alloc(6400) });
    await vi.advanceTimersByTimeAsync(0);
    engine.last.drop({ code: 429, type: 'rate_limit', retryable: true, rateLimited: true, fatal: false });
    expect(alerts).toEqual(['soniox_concurrency_429']);
    vi.useRealTimers();
  });
  it('raises mm_stream_cap and waits (no Soniox connect) when the MeetingMind cap is exhausted', async () => {
    vi.useFakeTimers();
    const alerts: string[] = [];
    const limiter = new StreamLimiter(0);
    const engine = new FakeEngine();
    const s = new MeetingSession({ ref: 'r', engine, sink: new MemorySink(), limiter, alert: (k) => alerts.push(k), config: { capBackoffMs: 1000 } });
    s.handleAudio({ relMs: 0, durMs: 200, pcm: Buffer.alloc(6400) });
    await vi.advanceTimersByTimeAsync(2500);
    expect(engine.connectCalls).toBe(0);
    expect(alerts).toContain('mm_stream_cap');
    vi.useRealTimers();
  });
});
