import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryQueue } from '../src/sink/queue.js';
import { HttpSink, signBody, verifySignature } from '../src/sink/httpSink.js';
import { SupabaseSink } from '../src/sink/supabaseSink.js';
import { MeetingMetrics } from '../src/metrics.js';
import type { LiveSegment } from '../src/sink/types.js';
import { MemorySink } from './helpers/memorySink.js';

const seg = (seq: number, over: Partial<LiveSegment> = {}): LiveSegment => ({
  key: `sess:${seq}`, seq, botId: 'bot-1', ref: 'ref-1', sessionId: 'sess',
  segment_text: `text ${seq}`, speaker_id: '100', speaker_name: 'Alice', is_host: true,
  start_timestamp: seq, end_timestamp: seq + 0.9, words: [], is_partial: false, language: 'en', ...over,
});

describe('signBody / verifySignature', () => {
  it('signs `${ts}.${body}` with HMAC-SHA256 as v1=<hex>', () => {
    const sig = signBody('sec', '1700000000', '{"a":1}');
    expect(sig).toBe('v1=' + createHmac('sha256', 'sec').update('1700000000.{"a":1}').digest('hex'));
    expect(verifySignature('sec', '1700000000', '{"a":1}', sig, { nowSec: 1700000100 })).toBe(true);
  });
  it('rejects tampered body, wrong secret, and stale timestamps', () => {
    const sig = signBody('sec', '1700000000', 'body');
    expect(verifySignature('sec', '1700000000', 'body2', sig, { nowSec: 1700000001 })).toBe(false);
    expect(verifySignature('x', '1700000000', 'body', sig, { nowSec: 1700000001 })).toBe(false);
    expect(verifySignature('sec', '1700000000', 'body', sig, { nowSec: 1700001000 })).toBe(false);
  });
});

describe('HttpSink', () => {
  it('POSTs a signed JSON batch in the documented shape', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{"ok":true}', { status: 200 }); });
    const sink = new HttpSink({ url: 'https://api.example/internal/live-segments', secret: 'sec', fetchFn: fetchFn as unknown as typeof fetch, nowSec: () => 1700000000 });
    await sink.write([seg(1), seg(2)]);
    expect(calls).toHaveLength(1);
    const body = String(calls[0]!.init.body);
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({ v: 1, botId: 'bot-1', ref: 'ref-1', sessionId: 'sess' });
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0]).toMatchObject({ key: 'sess:1', seq: 1, segment_text: 'text 1', speaker_id: '100', speaker_name: 'Alice', is_host: true, start_timestamp: 1, end_timestamp: 1.9, is_partial: false });
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h['x-mm-timestamp']).toBe('1700000000');
    expect(h['x-mm-signature']).toBe(signBody('sec', '1700000000', body));
    expect(h['content-type']).toBe('application/json');
  });
  it.each([[500, true], [503, true], [429, true], [408, true], [404, false], [400, false], [401, false], [403, false]])('status %i retryable=%s', async (status, retryable) => {
    const sink = new HttpSink({ url: 'https://x/y', secret: 's', fetchFn: (async () => new Response('', { status })) as unknown as typeof fetch });
    await expect(sink.write([seg(1)])).rejects.toMatchObject({ retryable });
  });
  it('treats a network error as retryable', async () => {
    const sink = new HttpSink({ url: 'https://x/y', secret: 's', fetchFn: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch });
    await expect(sink.write([seg(1)])).rejects.toMatchObject({ retryable: true });
  });
  it('times out a hung request', async () => {
    const sink = new HttpSink({ url: 'https://x/y', secret: 's', timeoutMs: 20, fetchFn: ((_u: string, init: RequestInit) => new Promise((_r, rej) => { init.signal?.addEventListener('abort', () => rej(new Error('aborted'))); })) as unknown as typeof fetch });
    await expect(sink.write([seg(1)])).rejects.toMatchObject({ retryable: true });
  });
});

describe('SupabaseSink', () => {
  it('looks up the bot run once and inserts rows in the live_transcripts shape', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/rest/v1/bot_runs')) return new Response(JSON.stringify([{ id: 'run-1', meeting_id: 'mtg-1', user_id: 'usr-1' }]), { status: 200 });
      return new Response('', { status: 201 });
    }) as unknown as typeof fetch;
    const sink = new SupabaseSink({ url: 'https://proj.supabase.co', serviceKey: 'svc', fetchFn });
    await sink.write([seg(1)]);
    await sink.write([seg(2)]);
    expect(calls.filter((c) => c.url.includes('bot_runs'))).toHaveLength(1);
    expect(calls[0]!.url).toContain('recall_bot_id=eq.bot-1');
    const inserts = calls.filter((c) => c.url.endsWith('/rest/v1/live_transcripts'));
    expect(inserts).toHaveLength(2);
    const rows = JSON.parse(String(inserts[0]!.init.body));
    expect(rows[0]).toEqual({
      meeting_id: 'mtg-1', bot_run_id: 'run-1', user_id: 'usr-1', segment_text: 'text 1', speaker_id: '100', speaker_name: 'Alice',
      is_host: true, start_timestamp: 1, end_timestamp: 1.9, words: [], is_partial: false,
    });
    const h = inserts[0]!.init.headers as Record<string, string>;
    expect(h.apikey).toBe('svc');
    expect(h.authorization).toBe('Bearer svc');
  });
  it('treats an unknown bot as a permanent error', async () => {
    const fetchFn = (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch;
    const sink = new SupabaseSink({ url: 'https://p.supabase.co', serviceKey: 'k', fetchFn });
    await expect(sink.write([seg(1)])).rejects.toMatchObject({ retryable: false });
  });
});

describe('DeliveryQueue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('delivers in order, batching what is waiting', async () => {
    const sink = new MemorySink();
    const m = new MeetingMetrics();
    const q = new DeliveryQueue(sink, { metrics: m, maxBatch: 10 });
    for (let i = 0; i < 25; i++) q.enqueue(seg(i));
    await q.drain(5000);
    expect(sink.segments.map((s) => s.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(m.snapshot().segmentsOut).toBe(25);
  });
  it('retries retryable failures with backoff and preserves order', async () => {
    const sink = new MemorySink();
    sink.failNext = 2;
    const m = new MeetingMetrics();
    const q = new DeliveryQueue(sink, { metrics: m, backoffMs: [100, 200, 400] });
    q.enqueue(seg(1)); q.enqueue(seg(2));
    const done = q.drain(10_000);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(sink.segments.map((s) => s.seq)).toEqual([1, 2]);
    expect(m.snapshot().sinkRetries).toBe(2);
  });
  it('drops a batch on a permanent error and carries on', async () => {
    const sink = new MemorySink();
    sink.failNext = 1; sink.failRetryable = false;
    const m = new MeetingMetrics();
    const q = new DeliveryQueue(sink, { metrics: m, maxBatch: 1 });
    q.enqueue(seg(1)); q.enqueue(seg(2));
    await q.drain(5000);
    expect(sink.segments.map((s) => s.seq)).toEqual([2]);
    expect(m.snapshot().segmentsFailed).toBe(1);
  });
  it('bounds memory: beyond maxQueue the oldest queued segments are dropped and counted', async () => {
    const sink = new MemorySink();
    sink.failNext = 1000; // sink down
    const m = new MeetingMetrics();
    const q = new DeliveryQueue(sink, { metrics: m, maxQueue: 50, backoffMs: [1000] });
    for (let i = 0; i < 500; i++) q.enqueue(seg(i));
    expect(q.length()).toBeLessThanOrEqual(50);
    expect(m.snapshot().segmentsDropped).toBeGreaterThanOrEqual(450);
  });
  it('gives up draining after the timeout without throwing', async () => {
    const sink = new MemorySink();
    sink.failNext = 1000;
    const q = new DeliveryQueue(sink, { metrics: new MeetingMetrics(), backoffMs: [1000] });
    q.enqueue(seg(1));
    const p = q.drain(500);
    await vi.advanceTimersByTimeAsync(600);
    await expect(p).resolves.toBeUndefined();
  });
});
