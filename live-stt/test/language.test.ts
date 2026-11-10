import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import WebSocket from 'ws';
import { mintIngestToken, parseIngestUrl } from '../src/auth.js';
import { parseControlBody, signControl, verifyControl } from '../src/control.js';
import { SONIOX_LANGUAGES, languageHints } from '../src/languages.js';
import { IngestServer } from '../src/server.js';
import { MeetingSession, type SessionConfig } from '../src/session.js';
import { FakeEngine, fin } from './helpers/fakeEngine.js';
import { MemorySink } from './helpers/memorySink.js';

const REF = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('languages', () => {
  it('knows the 60 Soniox codes, hints are [] for auto / unknown / empty', () => {
    expect(SONIOX_LANGUAGES.size).toBe(60);
    expect(languageHints('auto')).toEqual([]);
    expect(languageHints(undefined)).toEqual([]);
    expect(languageHints('klingon')).toEqual([]);
    expect(languageHints('ES')).toEqual(['es']);
    expect(languageHints('ar')).toEqual(['ar']); // the service accepts everything Soniox does; the backend allow-list is narrower
  });
});

describe('parseIngestUrl lang', () => {
  it('returns a valid lang, ignores invalid ones, and the token is unaffected', () => {
    expect(parseIngestUrl(`/ingest/${REF}/?token=abc&lang=fr`)).toEqual({ ref: REF, token: 'abc', lang: 'fr' });
    expect(parseIngestUrl(`/ingest/${REF}/?token=abc&lang=zz`)).toEqual({ ref: REF, token: 'abc' });
    expect(parseIngestUrl(`/ingest/${REF}/?token=abc&lang=auto`)).toEqual({ ref: REF, token: 'abc' });
    expect(parseIngestUrl(`/ingest/${REF}/?token=abc`)).toEqual({ ref: REF, token: 'abc' });
  });
});

describe('control signature', () => {
  const body = '{"v":1,"ref":"r","language":"es"}';
  it('matches the backend formula (v1= + HMAC-SHA256(secret, "control.<ts>.<body>"))', () => {
    expect(signControl('k', '100', body)).toBe('v1=' + createHmac('sha256', 'k').update(`control.100.${body}`).digest('hex'));
  });
  it('verifies against any rotated secret within +/-5 minutes only, and not as a segment-sink signature', () => {
    const sig = signControl('new', '1000', body);
    const ok = (o: Partial<Parameters<typeof verifyControl>[0]> = {}) => verifyControl({ secrets: ['new', 'old'], timestampSec: '1000', signature: sig, rawBody: body, nowSec: 1000, ...o });
    expect(ok()).toBe(true);
    expect(ok({ secrets: ['other'] })).toBe(false);
    expect(ok({ nowSec: 1000 + 301 })).toBe(false);
    expect(ok({ nowSec: 1000 - 301 })).toBe(false);
    expect(ok({ rawBody: body + ' ' })).toBe(false);
    expect(ok({ signature: undefined })).toBe(false);
    expect(ok({ timestampSec: 'abc' })).toBe(false);
    expect(ok({ secrets: [] })).toBe(false);
    const sinkSig = 'v1=' + createHmac('sha256', 'new').update(`1000.${body}`).digest('hex');
    expect(ok({ signature: sinkSig })).toBe(false);
  });
  it('parses only the strict body', () => {
    const R = 'ref-12345678';
    expect(parseControlBody(`{"v":1,"ref":"${R}","language":"es"}`)).toEqual({ ref: R, language: 'es' });
    expect(parseControlBody(`{"v":1,"ref":"${R}","language":"auto"}`)).toEqual({ ref: R, language: 'auto' });
    for (const bad of ['', 'x', `{"v":2,"ref":"${R}","language":"es"}`, `{"v":1,"ref":"${R}"}`, `{"v":1,"ref":"${R}","language":"klingon"}`, `{"v":1,"ref":"${R}","language":"es","extra":1}`, '{"v":1,"ref":"bad ref!","language":"es"}', '{"v":1,"ref":"r","language":"es"}']) {
      expect(parseControlBody(bad)).toBeNull();
    }
  });
});

// ------------------------------------------------------------------------------------------------ session

const CHUNK = 6400;
let rel = 0;
const feed = (s: MeetingSession, n: number) => { for (let i = 0; i < n; i++) { s.handleAudio({ relMs: rel, durMs: 200, pcm: Buffer.alloc(CHUNK, 3) }); rel += 200; } };
const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };
const mk = (over: Partial<SessionConfig> = {}, extra: { limiter?: any } = {}) => {
  const engine = new FakeEngine('primary');
  const sink = new MemorySink();
  const s = new MeetingSession({ ref: 'ref-1', sessionId: 'sess', engine, sink, limiter: extra.limiter, config: { idleFlushMs: 1500, keepaliveMs: 10_000, ...over } });
  s.setBotId('bot-1');
  return { engine, sink, s };
};

describe('MeetingSession.setLanguageHints', () => {
  beforeEach(() => { vi.useFakeTimers(); rel = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('initial hints reach the first Soniox connection', async () => {
    const { engine, s } = mk({ languageHints: ['fr'] });
    feed(s, 3);
    await settle();
    expect(engine.last.opts.languageHints).toEqual(['fr']);
  });

  it('before any audio: nothing is opened, the first connection uses the new hints', async () => {
    const { engine, s } = mk();
    expect(s.setLanguageHints(['es'])).toBe(true);
    expect(engine.connectCalls).toBe(0);
    feed(s, 3);
    await settle();
    expect(engine.last.opts.languageHints).toEqual(['es']);
  });

  it('same hints are a no-op (no reconnect)', async () => {
    const { engine, s } = mk({ languageHints: ['es'] });
    feed(s, 5);
    await settle();
    expect(s.setLanguageHints(['es'])).toBe(false);
    await settle();
    expect(engine.connectCalls).toBe(1);
    expect(s.metrics.snapshot().languageChanges).toBe(0);
  });

  it('mid-meeting change reopens the stream with the new hints and replays from just before the final watermark (nothing lost, nothing doubled)', async () => {
    const { engine, sink, s } = mk();
    feed(s, 25); // 5 s
    await settle();
    const a = engine.conns[0]!;
    expect(a.opts.languageHints).toEqual([]);
    // finals up to 2.0 s are delivered; 2.0-5.0 s are still unfinalised audio
    a.say([fin('Hello', 400, 900), fin(' there', 1000, 1900)], 2000);
    expect(s.setLanguageHints(['es'])).toBe(true);
    await settle();
    expect(engine.conns).toHaveLength(2);
    const b = engine.conns[1]!;
    expect(a.closed).toBe(true);
    expect(b.opts.languageHints).toEqual(['es']);
    expect(s.state()).toBe('streaming');
    // B replays from watermark - 1 s = 1.0 s: chunks ending after 1000 ms => from the chunk starting at 1000 ms (2 s - 1 s margin)
    const replayedMs = (b.bytes / CHUNK) * 200;
    expect(replayedMs).toBeGreaterThanOrEqual(5000 - 2000); // at least everything after the watermark
    expect(replayedMs).toBeLessThanOrEqual(5000 - 800);     // but not the whole meeting
    // stream clock of B starts at the first replayed chunk. B re-recognises 'there' (already delivered) and new speech.
    const base = 1000;
    b.say([fin(' there', 1000 - base, 1900 - base), fin(' hola', 2500 - base, 3000 - base), fin(' amigos', 3100 - base, 3800 - base)], 3800 - base);
    feed(s, 5); // live audio now goes to B only
    expect(b.bytes / CHUNK).toBeGreaterThan(replayedMs / 200);
    expect(a.audio.length).toBe(25);
    await settle(3000);
    expect(sink.segments.map((x) => x.segment_text).join(' ').replace(/\s+/g, ' ')).toBe('Hello there hola amigos');
    const m = s.metrics.snapshot();
    expect(m.languageChanges).toBe(1);
    expect(m.reconnects).toBe(0);
    expect(m.gaps).toBe(0);
  });

  it('changing back to auto sends no hints', async () => {
    const { engine, s } = mk({ languageHints: ['de'] });
    feed(s, 10);
    await settle();
    s.setLanguageHints([]);
    await settle();
    expect(engine.conns).toHaveLength(2);
    expect(engine.conns[1]!.opts.languageHints).toEqual([]);
  });

  it('while Soniox is down and a reconnect is scheduled: no extra stream, the reconnect uses the new hints', async () => {
    const { engine, s } = mk({ backoffMs: [1000] });
    feed(s, 10);
    await settle();
    engine.last.drop({ code: 503, type: 'unavailable', retryable: true, fatal: false });
    await settle(10);
    s.setLanguageHints(['it']);
    expect(engine.connectCalls).toBe(1);
    await settle(1500);
    expect(engine.connectCalls).toBe(2);
    expect(engine.last.opts.languageHints).toEqual(['it']);
  });

  it('an in-flight rollover stream is dropped and the active stream is reopened with the new hints', async () => {
    const { engine, s } = mk({ maxStreamMs: 60_000, rolloverMarginMs: 20_000, overlapMs: 4_000, promoteTimeoutMs: 15_000 });
    feed(s, 5);
    await settle();
    feed(s, 200); // 41 s -> rollover starts
    await settle();
    expect(engine.conns).toHaveLength(2);
    s.setLanguageHints(['ja']);
    await settle();
    expect(engine.conns[1]!.closed).toBe(true);
    const last = engine.last;
    expect(last).not.toBe(engine.conns[1]);
    expect(last.opts.languageHints).toEqual(['ja']);
    expect(engine.conns[0]!.closed).toBe(true);
  });

  it('releases and re-acquires the global stream slot (cap of 1 still works)', async () => {
    let inUse = 0;
    const limiter = { acquire: () => (inUse < 1 ? (inUse++, true) : false), release: () => { inUse--; }, capacity: () => 1, inUse: () => inUse };
    const { engine, s } = mk({}, { limiter });
    feed(s, 10);
    await settle();
    s.setLanguageHints(['pl']);
    await settle();
    expect(engine.conns).toHaveLength(2);
    expect(inUse).toBe(1);
    const closing = s.close();
    await settle(5000);
    await closing;
    expect(inUse).toBe(0);
  });

  it('ignored after the session is closed', async () => {
    const { engine, s } = mk();
    feed(s, 5);
    await settle();
    const p = s.close();
    await settle(5000);
    await p;
    const before = engine.connectCalls;
    s.setLanguageHints(['fr']);
    await settle();
    expect(engine.connectCalls).toBe(before);
  });
});

// ------------------------------------------------------------------------------------------------ server control endpoint

describe('POST /control/language', () => {
  const CONTROL = 'control-secret';
  let server: IngestServer;
  let port: number;
  let engine: FakeEngine;
  const pcm = Buffer.alloc(6400, 2);
  const audio = (relative: number) => JSON.stringify({ event: 'audio_mixed_raw.data', data: { data: { buffer: pcm.toString('base64'), timestamp: { relative, absolute: 'x' } }, bot: { id: 'bot-1' } } });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const open = (ref: string, qs = '') => new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ingest/${ref}/?token=${mintIngestToken('ingest', ref)}${qs}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
  const post = async (bodyObj: unknown, o: { secret?: string; ts?: string; sig?: string; raw?: string } = {}) => {
    const raw = o.raw ?? JSON.stringify(bodyObj);
    const ts = o.ts ?? String(Math.floor(Date.now() / 1000));
    const r = await fetch(`http://127.0.0.1:${port}/control/language`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mm-timestamp': ts, 'x-mm-signature': o.sig ?? signControl(o.secret ?? CONTROL, ts, raw) },
      body: raw,
    });
    return { status: r.status, json: await r.json().catch(() => ({})) as any };
  };

  beforeEach(async () => {
    engine = new FakeEngine();
    server = new IngestServer({
      ingestSecrets: ["ingest"], controlSecrets: [CONTROL], maxControlPerMin: 100000, engine, sink: new MemorySink(), maxStreams: 3, maxSessions: 3,
      recallGraceMs: 300, session: { idleFlushMs: 50, closeGraceMs: 50 },
    });
    port = await server.listen(0, '127.0.0.1');
  });
  afterEach(async () => { await server.stop(); });

  it('disabled (404) when no control secret is configured', async () => {
    await server.stop();
    server = new IngestServer({ ingestSecrets: ['ingest'], engine, sink: new MemorySink(), maxStreams: 3, maxSessions: 3 });
    port = await server.listen(0, '127.0.0.1');
    expect((await post({ v: 1, ref: REF, language: 'es' })).status).toBe(404);
  });

  it('rejects bad / stale signatures (401) and bad bodies (400); never touches a session', async () => {
    const ws = await open(REF);
    ws.send(audio(0));
    await wait(40);
    expect((await post({ v: 1, ref: REF, language: 'es' }, { secret: 'wrong' })).status).toBe(401);
    expect((await post({ v: 1, ref: REF, language: 'es' }, { ts: String(Math.floor(Date.now() / 1000) - 3600) })).status).toBe(401);
    expect((await post({ v: 1, ref: REF, language: 'klingon' })).status).toBe(400);
    expect((await post(null, { raw: 'not json' })).status).toBe(400);
    expect(engine.connectCalls).toBe(1);
    ws.close();
  });

  it('a live session is reconfigured: 200 applied, new stream has the hint', async () => {
    const ws = await open(REF);
    ws.send(audio(0));
    await wait(40);
    const r = await post({ v: 1, ref: REF, language: 'es' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ applied: true, changed: true });
    await wait(60);
    expect(engine.conns).toHaveLength(2);
    expect(engine.last.opts.languageHints).toEqual(['es']);
    // the same value again is acknowledged without another reconnect
    const again = await post({ v: 1, ref: REF, language: 'es' });
    expect(again.json).toMatchObject({ applied: true, changed: false });
    await wait(40);
    expect(engine.conns).toHaveLength(2);
    ws.close();
  });

  it("'auto' clears the hints", async () => {
    const ws = await open(REF, '&lang=fr');
    ws.send(audio(0));
    await wait(40);
    expect(engine.last.opts.languageHints).toEqual(['fr']);
    expect((await post({ v: 1, ref: REF, language: 'auto' })).json.changed).toBe(true);
    await wait(60);
    expect(engine.last.opts.languageHints).toEqual([]);
    ws.close();
  });

  it('no session yet: 202 queued, applied when that meeting connects (and beats the URL value)', async () => {
    const r = await post({ v: 1, ref: REF, language: 'de' });
    expect(r.status).toBe(202);
    expect(r.json).toMatchObject({ applied: false, queued: true });
    const ws = await open(REF, '&lang=fr');
    ws.send(audio(0));
    await wait(40);
    expect(engine.last.opts.languageHints).toEqual(['de']);
    ws.close();
  });

  it('the URL language is the initial hint when nothing was queued', async () => {
    const ws = await open(REF, '&lang=ko');
    ws.send(audio(0));
    await wait(40);
    expect(engine.last.opts.languageHints).toEqual(['ko']);
    ws.close();
  });

  it('a queued change for a ref that never connects is bounded (no unbounded memory)', async () => {
    for (let i = 0; i < 700; i++) await post({ v: 1, ref: `ref-${String(i).padStart(10, '0')}`, language: 'es' });
    expect(server.pendingLanguageCount()).toBeLessThanOrEqual(500);
  }, 30_000);
});
