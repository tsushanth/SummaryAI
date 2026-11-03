import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingSession, type SessionConfig } from '../src/session.js';
import { FakeEngine, fin, part } from './helpers/fakeEngine.js';
import { MemorySink } from './helpers/memorySink.js';

const CHUNK = 6400;
const pcm = () => Buffer.alloc(CHUNK, 3);
let rel = 0;
const feed = (s: MeetingSession, n: number, atMs = rel) => {
  rel = atMs;
  for (let i = 0; i < n; i++) { s.handleAudio({ relMs: rel, durMs: 200, pcm: pcm() }); rel += 200; }
};
const mk = (over: Partial<SessionConfig> = {}, opts: { fallback?: FakeEngine } = {}) => {
  const engine = new FakeEngine('primary');
  const sink = new MemorySink();
  const s = new MeetingSession({
    ref: 'ref-1', sessionId: 'sess', engine, fallbackEngine: opts.fallback, sink,
    config: { idleFlushMs: 1500, keepaliveMs: 10_000, ...over },
  });
  s.setBotId('bot-1');
  return { engine, sink, s };
};
const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

beforeEach(() => { vi.useFakeTimers(); rel = 0; });
afterEach(() => { vi.useRealTimers(); });

describe('MeetingSession streaming', () => {
  it('connects on first audio and replays what arrived while connecting', async () => {
    const { engine, s } = mk();
    feed(s, 5);
    await settle();
    expect(engine.conns).toHaveLength(1);
    expect(engine.last.bytes).toBe(5 * CHUNK);
    feed(s, 3);
    expect(engine.last.bytes).toBe(8 * CHUNK);
    expect(s.metrics.snapshot().audioSecondsIn).toBeCloseTo(1.6, 5);
    expect(s.state()).toBe('streaming');
  });

  it('writes only final tokens, as segments with seconds-based timestamps and Recall-style words', async () => {
    const { engine, sink, s } = mk();
    s.handleSpeech({ on: true, participant: { id: '100', name: 'Alice', isHost: true }, relMs: 0 });
    feed(s, 20);
    await settle();
    engine.last.say([part('Hello wor', 0, 500)]);
    expect(sink.segments).toEqual([]);
    engine.last.say([fin('Hello', 400, 700), fin(' world', 800, 1200), fin('.', 1200, 1250)], 1250);
    await settle(0);
    // sentence end but < minWordsForSentenceBreak (3): wait for the idle flush
    await settle(2000);
    expect(sink.segments).toHaveLength(1);
    const seg = sink.segments[0]!;
    expect(seg).toMatchObject({ botId: 'bot-1', ref: 'ref-1', sessionId: 'sess', seq: 0, key: 'sess:0', segment_text: 'Hello world.', speaker_id: '100', speaker_name: 'Alice', is_host: true, is_partial: false, language: 'en' });
    expect(seg.start_timestamp).toBeCloseTo(0.4, 3);
    expect(seg.end_timestamp).toBeCloseTo(1.25, 3);
    expect(seg.words[0]).toEqual({ text: 'Hello', start_timestamp: { relative: 0.4 }, end_timestamp: { relative: 0.7 } });
  });

  it('numbers segments in order and flushes on a speaker change immediately', async () => {
    const { engine, sink, s } = mk();
    feed(s, 20);
    await settle();
    engine.last.say([fin('Hi', 0, 200, '1'), fin(' there', 200, 500, '1'), fin('Hello', 600, 900, '2')]);
    await settle();
    expect(sink.segments.map((x) => [x.seq, x.segment_text, x.speaker_name])).toEqual([[0, 'Hi there', 'Speaker 1']]);
    await settle(2000);
    expect(sink.segments.map((x) => x.seq)).toEqual([0, 1]);
  });

  it('sends keepalive when no audio flows', async () => {
    const { engine, s } = mk();
    feed(s, 2);
    await settle();
    await settle(25_000);
    expect(engine.last.keepalives).toBeGreaterThanOrEqual(2);
  });

  it('counts gaps when Recall audio skips ahead and maps token times across the gap', async () => {
    const { engine, sink, s } = mk();
    feed(s, 5, 0); // 0..1000
    feed(s, 5, 6000); // gap of 5000 ms, then 6000..7000
    await settle();
    const snap = s.metrics.snapshot();
    expect(snap.gaps).toBe(1);
    expect(snap.gapSeconds).toBeCloseTo(5, 1);
    // stream clock: 0..1000 stream-ms = rel 0..1000; 1000..2000 stream-ms = rel 6000..7000
    engine.last.say([fin('late', 1100, 1300)]);
    await settle(2000);
    expect(sink.segments[0]!.start_timestamp).toBeCloseTo(6.1, 2);
  });

  it('rejects odd chunk sizes without throwing', async () => {
    const { s } = mk();
    expect(() => s.handleAudio({ relMs: 0, durMs: 200, pcm: Buffer.alloc(3) })).not.toThrow();
    expect(s.metrics.snapshot().invalidMessages).toBe(1);
  });
});

describe('MeetingSession resilience', () => {
  it('reconnects after a drop with backoff and replays from the final watermark (loses no audio)', async () => {
    const { engine, sink, s } = mk();
    feed(s, 30); // 6 s
    await settle();
    engine.last.say([fin('one', 0, 400), fin(' two', 400, 800), fin(' three', 800, 2000)], 2000);
    engine.last.drop();
    await settle(100);
    expect(engine.conns).toHaveLength(1); // still backing off (500 ms)
    feed(s, 5); // arrives while down: 6000..7000
    await settle(500);
    expect(engine.conns).toHaveLength(2);
    // replay starts 1 s before the final watermark (a straddling word is not final yet): chunk 5 (1000 ms) .. 34 = 30 chunks
    expect(engine.last.bytes).toBe(30 * CHUNK);
    expect(s.metrics.snapshot().reconnects).toBe(1);
    expect(s.metrics.snapshot().gapSeconds).toBe(0);
    // new stream clock starts at rel 1000; Soniox re-recognises 'three' from the overlap (mid < watermark: dropped) and adds 'four'
    engine.last.say([fin('three', 0, 1000), fin(' four', 1200, 1700)]);
    await settle(2000);
    expect(sink.segments.map((x) => x.segment_text).join(' ')).toBe('one two three four');
  });

  it('uses growing backoff and resets it after a successful stream', async () => {
    const { engine, s } = mk({ backoffMs: [500, 1000, 2000] });
    feed(s, 5);
    await settle();
    engine.failConnects = 2;
    engine.last.drop();
    await settle(500); // attempt 1 fails
    expect(engine.connectCalls).toBe(2);
    await settle(900);
    expect(engine.connectCalls).toBe(2); // second backoff is 1000
    await settle(100);
    expect(engine.connectCalls).toBe(3); // attempt 2 fails
    await settle(2000);
    expect(engine.connectCalls).toBe(4); // succeeded
    expect(engine.conns).toHaveLength(2);
    expect(s.state()).toBe('streaming');
  });

  it('backs off at least rateLimitBackoffMs after a 429', async () => {
    const { engine, s } = mk({ rateLimitBackoffMs: 20_000 });
    feed(s, 5);
    await settle();
    engine.last.drop({ code: 429, type: 'rate_limit', retryable: true, rateLimited: true, fatal: false });
    await settle(19_000);
    expect(engine.connectCalls).toBe(1);
    await settle(1500);
    expect(engine.connectCalls).toBe(2);
  });

  it('does not retry a fatal error (bad key) and reports degraded', async () => {
    const { engine, s } = mk();
    feed(s, 5);
    await settle();
    engine.last.drop({ code: 401, type: 'unauthenticated', retryable: false, fatal: true });
    await settle(60_000);
    expect(engine.connectCalls).toBe(1);
    expect(s.state()).toBe('degraded');
    expect(s.metrics.snapshot().degraded).toBe(true);
    // audio keeps arriving but memory stays bounded
    feed(s, 3000); // 10 minutes
    expect(s.debug().bufferedBytes).toBeLessThanOrEqual(60_000 * 32 + CHUNK);
  });

  it('fails over to the fallback engine after failoverAfterMs of failures', async () => {
    const fallback = new FakeEngine('elevenlabs');
    const { engine, s } = mk({ failoverAfterMs: 30_000, backoffMs: [500, 1000, 2000, 2000] }, { fallback });
    feed(s, 5);
    await settle();
    engine.failConnects = 1000;
    engine.last.drop({ code: 503, type: 'service_unavailable', retryable: true, fatal: false });
    await settle(29_000);
    expect(fallback.connectCalls).toBe(0);
    await settle(5_000);
    expect(fallback.conns).toHaveLength(1);
    expect(s.metrics.snapshot().failovers).toBe(1);
    expect(s.state()).toBe('streaming');
    feed(s, 2);
    expect(fallback.last.bytes).toBeGreaterThan(0);
  });

  it('fails over immediately on a fatal primary error when a fallback exists', async () => {
    const fallback = new FakeEngine('elevenlabs');
    const { engine, s } = mk({}, { fallback });
    feed(s, 5);
    await settle();
    engine.last.drop({ code: 402, type: 'payment_required', retryable: false, fatal: true });
    await settle(10);
    expect(fallback.conns).toHaveLength(1);
  });

  it('rolls over to a new stream before the 300-minute limit with overlap and no duplicate or missing words', async () => {
    const { engine, sink, s } = mk({ maxStreamMs: 60_000, rolloverMarginMs: 20_000, overlapMs: 4_000, promoteTimeoutMs: 15_000 });
    // 41 s of audio -> rollover trigger at 40 s of audio on stream 0
    feed(s, 195); // 39 s
    await settle();
    engine.last.say([fin('before', 38_000, 38_500)], 38_500);
    feed(s, 10); // to 41 s -> triggers rollover
    await settle();
    expect(engine.conns).toHaveLength(2);
    const a = engine.conns[0]!, b = engine.conns[1]!;
    // B replays from 1 s before A's final watermark (38.5 s) and then receives live audio too
    expect(b.bytes).toBeGreaterThan(0);
    const bBytesAtOpen = b.bytes;
    feed(s, 25); // 5 s more live audio to both
    expect(b.bytes).toBeGreaterThan(bBytesAtOpen);
    expect(a.bytes).toBeGreaterThan(0);
    // A still primary during overlap and emits a word at ~41.2 s
    a.say([fin(' overlap', 41_200, 41_600)], 41_600);
    // B's stream clock base = 37.4 s (chunk containing 37.5). It transcribes the same audio: same word at 41.2 s abs
    b.say([fin(' overlap', 41_200 - 37_400, 41_600 - 37_400), fin(' after', 43_000 - 37_400, 43_400 - 37_400)], 43_400 - 37_400);
    a.say([], 43_400); // A's watermark advances so B may be promoted
    await settle(5_000);
    expect(a.finalizes).toBe(1);
    expect(a.ended).toBe(true);
    expect(s.metrics.snapshot().rollovers).toBe(1);
    // after promotion, new audio goes only to B
    const aBytes = a.bytes;
    feed(s, 5);
    expect(a.bytes).toBe(aBytes);
    await settle(2000);
    expect(sink.segments.map((x) => x.segment_text).join(' ').replace(/\s+/g, ' ')).toBe('before overlap after');
    expect(s.metrics.snapshot().reconnects).toBe(0);
  });

  it('keeps the old stream if the rollover stream cannot connect, and reconnects normally when the limit closes it', async () => {
    const { engine, s } = mk({ maxStreamMs: 60_000, rolloverMarginMs: 20_000, overlapMs: 4_000, backoffMs: [500] });
    feed(s, 195);
    await settle();
    engine.failConnects = 1;
    feed(s, 10);
    await settle();
    expect(engine.conns).toHaveLength(1);
    // Soniox closes the capped stream with 413
    engine.conns[0]!.drop({ code: 413, type: 'max_duration_reached', retryable: true, maxDuration: true, fatal: false });
    await settle(1000);
    expect(engine.conns.length).toBeGreaterThanOrEqual(2);
  });

  it('bounds memory over an hour of audio with a dead Soniox (unsent audio capped at hardCapMs)', async () => {
    const { engine, s } = mk({ hardCapMs: 60_000 });
    feed(s, 2);
    await settle();
    engine.failConnects = 1_000_000;
    engine.last.drop({ code: 503, type: 'service_unavailable', retryable: true, fatal: false });
    for (let minute = 0; minute < 60; minute++) { feed(s, 300); await settle(60_000 > 0 ? 1000 : 0); }
    expect(s.debug().bufferedBytes).toBeLessThanOrEqual(60_000 * 32 + CHUNK);
    expect(s.metrics.snapshot().gapSeconds).toBeGreaterThan(3000); // honest accounting of what was lost
  });

  it('close() finalizes the stream, flushes the open segment and drains the sink', async () => {
    const { engine, sink, s } = mk();
    feed(s, 10);
    await settle();
    engine.last.say([fin('last', 0, 300), fin(' words', 300, 700)]);
    const closing = s.close();
    await settle(200);
    // server answers the finalize with its remaining finals + finished
    engine.last.emit({ tokens: [], finalAudioProcMs: 2000, totalAudioProcMs: 2000, finished: true });
    await settle(3_000);
    await closing;
    expect(engine.last.finalizes).toBe(1);
    expect(engine.last.ended).toBe(true);
    expect(sink.segments.map((x) => x.segment_text)).toEqual(['last words']);
    expect(s.state()).toBe('closed');
    // audio after close is ignored
    feed(s, 1);
    expect(engine.last.bytes).toBe(10 * CHUNK);
  });

  it('never rejects unhandled when the engine throws from sendAudio or handlers', async () => {
    const { engine, s } = mk();
    feed(s, 3);
    await settle();
    engine.last.sendAudio = () => { throw new Error('socket gone'); };
    expect(() => feed(s, 2)).not.toThrow();
    await settle(1000);
    expect(engine.connectCalls).toBeGreaterThanOrEqual(2); // treated as a drop
  });
});
