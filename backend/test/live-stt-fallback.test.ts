import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { LiveDb } from './helpers-liveDb.js';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: (t: string) => h.db.from(t) } }));
const queueInsightGeneration = vi.fn(async (_m: string, _u: string) => {});
vi.mock('../src/services/liveInsightsService.js', () => ({ queueInsightGeneration }));
vi.mock('../src/services/voiceAssistant/manager.js', () => ({ getVoiceAssistantManager: () => ({ handleLive: vi.fn(async () => ({ handled: true })) }) }));
vi.mock('../src/services/recallService.js', () => ({ finalizeBotRecording: vi.fn() }));
vi.mock('../src/services/processingService.js', () => ({ triggerProcessing: vi.fn() }));

const SECRET = 'sink-secret-for-tests';
const REF = '3f2b8c1e-aaaa-4bbb-8ccc-0123456789ab';
const RECALL_BOT = 'recall-bot-1';
const BASE_MS = Date.UTC(2026, 10, 10, 12, 0, 0);

const { liveSegmentsRouter, liveSegmentsBodyParser, signLiveSegments } = await import('../src/routes/liveSegments.js');
const webhooks = (await import('../src/routes/webhooks.js')).default;
const fb = await import('../src/lib/liveSttFallback.js');
const metrics = await import('../src/lib/liveSttMetrics.js');
const { stitchStuckRecording } = await import('../src/services/stuckMeetingRecovery.js');

let server: Server;
let base: string;
let db: LiveDb;
let logs: string[];
const envKeys = ['LIVE_STT_SHARED_SECRET', 'LIVE_STT_FALLBACK', 'LIVE_STT_FILLER_FILTER', 'LIVE_STT_RECALL_HOT_STANDBY'];
let saved: Record<string, string | undefined> = {};

async function start() {
  const app = express();
  app.use('/internal/live-segments', liveSegmentsBodyParser);
  app.use(express.json({ limit: '10mb' }));
  app.use('/internal/live-segments', liveSegmentsRouter({ nowSec: () => Math.floor(Date.now() / 1000) }));
  app.use('/webhooks', webhooks);
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function sink(body: unknown) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${base}/internal/live-segments`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mm-timestamp': ts, 'x-mm-signature': signLiveSegments(SECRET, ts, raw) }, body: raw });
  let json: any = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json };
}

async function recallWebhook(startSec: number, endSec: number, words = 'we need to review the budget'.split(' '), event = 'transcript.data') {
  const n = words.length;
  const step = (endSec - startSec) / n;
  const res = await fetch(`${base}/webhooks/recall/transcript`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event,
      data: { bot: { id: RECALL_BOT }, data: { participant: { id: 7, name: 'Zed Recall', is_host: false }, words: words.map((w, i) => ({ text: w, start_timestamp: { relative: startSec + i * step }, end_timestamp: { relative: startSec + (i + 1) * step } })) } },
    }),
  });
  return res.status;
}

/** A fake of the live-stt service as the backend sees it: Soniox results arrive as sink batches, failures as health events. */
class FakeSonioxService {
  private n = 0;
  async speak(fromSec: number, toSec: number, text = (i: number) => `soniox sentence number ${i} about the roadmap`) {
    const segs = [];
    for (let t = fromSec; t < toSec; t += 5) segs.push(this.seg(t, t + 4, text(this.n)));
    return sink({ v: 1, ref: REF, sessionId: 's1', segments: segs });
  }
  seg(start: number, end: number, text: string) {
    const i = this.n++;
    return { key: `s1:${i}`, seq: i, segment_text: text, speaker_id: '1', speaker_name: 'Ada Soniox', is_host: false, start_timestamp: start, end_timestamp: end, words: [], is_partial: false, language: 'en' };
  }
  junk(startSec: number, count = 3, text = 'Hmm.') {
    return sink({ v: 1, ref: REF, sessionId: 's1', segments: Array.from({ length: count }, (_, k) => this.seg(startSec + k * 2, startSec + k * 2 + 1, text)) });
  }
  /** connect failure: never opens; the service gives up after its bounded retry and reports it. */
  connectFails() { return sink({ v: 1, ref: REF, sessionId: 's1', event: { type: 'stream_degraded', reason: 'connect' } }); }
  /** mid-stream failure: the socket closes and the service's reconnect window runs out. */
  closesMidStream() { return sink({ v: 1, ref: REF, sessionId: 's1', event: { type: 'stream_degraded', reason: 'closed' } }); }
  /** auth error: Soniox answers 401/402/403, nothing to retry. */
  authFails() { return sink({ v: 1, ref: REF, sessionId: 's1', event: { type: 'stream_fatal', reason: 'auth', code: 401 } }); }
  rateLimited() { return sink({ v: 1, ref: REF, sessionId: 's1', event: { type: 'stream_degraded', reason: 'rate_limit', code: 429 } }); }
  /** silent stream: connected, audio flows, no results, no error. The service sends nothing at all. */
  silent() { return Promise.resolve(); }
}

const run = () => db.rows('bot_runs')[0]!;
const state = () => fb.parseFallbackState(run().live_stt_fallback);
const live = () => db.rows('live_transcripts');
const visible = () => live().filter((r) => !r.shadow && !r.is_partial);
const hidden = () => live().filter((r) => r.shadow);

function seedRun(over: Record<string, unknown> = {}) {
  db.seed('bot_runs', { id: 'run-1', meeting_id: 'meet-1', user_id: 'user-1', live_stt_ref: REF, live_stt_provider: 'soniox', recall_bot_id: RECALL_BOT, status: 'recording', joined_at: new Date(BASE_MS).toISOString(), ...over });
}

beforeEach(async () => {
  db = new LiveDb();
  h.db = db;
  saved = {};
  for (const k of envKeys) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.LIVE_STT_SHARED_SECRET = SECRET;
  metrics.resetLiveSttMetrics();
  fb.resetFallbackColumnFlag();
  fb.resetFallbackThrottle();
  queueInsightGeneration.mockClear();
  logs = [];
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  vi.useFakeTimers({ toFake: ['Date'], now: BASE_MS });
  await start();
});
afterEach(async () => {
  await new Promise((r) => server?.close(r));
  vi.useRealTimers();
  for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.restoreAllMocks();
});
const advance = (sec: number) => vi.setSystemTime(Date.now() + sec * 1000);

// ---------------------------------------------------------------------------------------------------------------------------
describe('default mode (no Recall transcript on the bot): failure marks the live transcript unavailable', () => {
  it('connect failure: no Soniox segment ever; declared unavailable at 0 s, nothing visible, bot untouched', async () => {
    seedRun();
    const svc = new FakeSonioxService();
    const r = await svc.connectFails();
    expect(r).toMatchObject({ status: 200, body: { ok: true, fallback: 'switched' } });
    expect(state()).toMatchObject({ active: true, mode: 'unavailable', reason: 'connect', switched_at_sec: 0, retries_used: 0 });
    expect(fb.liveStatusOf(state())).toBe('unavailable');
    expect(visible()).toHaveLength(0);
    expect(run().status).toBe('recording'); // the bot keeps recording; nothing else about the run changed
    expect(queueInsightGeneration).not.toHaveBeenCalled();
  });

  it('mid-stream failure: segments already received are kept and visible; the switch point is the last Soniox second', async () => {
    seedRun();
    const svc = new FakeSonioxService();
    await svc.speak(0, 60);
    expect(visible()).toHaveLength(12);
    const r = await svc.closesMidStream();
    expect(r.body.fallback).toBe('switched');
    expect(state()).toMatchObject({ active: true, mode: 'unavailable', reason: 'closed', switched_at_sec: 59 });
    expect(visible()).toHaveLength(12); // nothing lost
    expect(state()!.events).toHaveLength(1);
    expect(state()!.events[0]).toMatchObject({ kind: 'switch', reason: 'closed', at_sec: 59 });
  });

  it('auth error: declared immediately, reason auth', async () => {
    seedRun();
    const r = await new FakeSonioxService().authFails();
    expect(r.body.fallback).toBe('switched');
    expect(state()).toMatchObject({ active: true, mode: 'unavailable', reason: 'auth' });
  });

  it('rate limit (concurrency cap): declared with reason rate_limit', async () => {
    seedRun();
    await new FakeSonioxService().rateLimited();
    expect(state()).toMatchObject({ reason: 'rate_limit', mode: 'unavailable' });
  });

  it('silent stream: no event, no segments. The watchdog declares it only after LIVE_STT_FALLBACK_NO_SEGMENTS_SEC in the call', async () => {
    seedRun();
    await new FakeSonioxService().silent();
    expect(await fb.sweepNoSegments({ nowMs: BASE_MS + 299_000 })).toBe(0);
    expect(state()).toBeNull();
    expect(await fb.sweepNoSegments({ nowMs: BASE_MS + 301_000 })).toBe(1);
    expect(state()).toMatchObject({ active: true, mode: 'unavailable', reason: 'no_segments' });
    expect(await fb.sweepNoSegments({ nowMs: BASE_MS + 400_000 })).toBe(0); // idempotent
    expect(state()!.events).toHaveLength(1);
  });

  it('silence AFTER the first segment is not declared a failure without Recall evidence (a quiet meeting looks the same)', async () => {
    seedRun();
    await new FakeSonioxService().speak(0, 20);
    expect(await fb.sweepNoSegments({ nowMs: BASE_MS + 3_600_000 })).toBe(0);
    expect(state()).toBeNull();
  });

  it('the watchdog ignores runs that are not in a call, are not Soniox runs, or already have a state', async () => {
    seedRun({ status: 'completed' });
    expect(await fb.sweepNoSegments({ nowMs: BASE_MS + 1_000_000 })).toBe(0);
    db.tables.bot_runs = [];
    seedRun({ live_stt_provider: 'recall' });
    expect(await fb.sweepNoSegments({ nowMs: BASE_MS + 1_000_000 })).toBe(0);
  });

  it('retry at most once: segments resuming after a declared outage return the meeting to ok ONCE; a second failure is final', async () => {
    seedRun();
    const svc = new FakeSonioxService();
    await svc.speak(0, 30);
    await svc.closesMidStream();
    expect(fb.liveStatusOf(state())).toBe('unavailable');

    await svc.speak(60, 90); // the service's reconnect worked
    expect(fb.liveStatusOf(state())).toBe('ok');
    expect(state()).toMatchObject({ active: false, retries_used: 1 });
    expect(state()!.events.map((e) => e.kind)).toEqual(['switch', 'recovered']);

    await svc.closesMidStream(); // fails again
    expect(fb.liveStatusOf(state())).toBe('unavailable');
    expect(state()!.retries_used).toBe(1);
    await svc.speak(120, 150); // it comes back again: NOT cleared a second time
    expect(fb.liveStatusOf(state())).toBe('unavailable');
    expect(visible().length).toBeGreaterThan(12); // the rows themselves are still stored and shown
  });

  it('a stream that was only late to its first segment is cleared without spending the retry', async () => {
    seedRun();
    await fb.sweepNoSegments({ nowMs: BASE_MS + 301_000 });
    expect(state()!.reason).toBe('no_segments');
    await new FakeSonioxService().speak(310, 330);
    expect(state()).toMatchObject({ active: false, retries_used: 0 });
  });

  it('duplicate failure reports are one switch', async () => {
    seedRun();
    const svc = new FakeSonioxService();
    await svc.speak(0, 20);
    await svc.closesMidStream();
    const again = await svc.closesMidStream();
    expect(again.body.fallback).toBe('already');
    expect(state()!.events).toHaveLength(1);
  });

  it('the live stitcher does not save a transcript with a hole; the final pass produces it', async () => {
    seedRun();
    db.seed('recordings', { id: 'rec-1', meeting_id: 'meet-1', status: 'pending' });
    const svc = new FakeSonioxService();
    await svc.speak(0, 30);
    await svc.closesMidStream();
    expect(await stitchStuckRecording('rec-1', 'meet-1')).toEqual({ stitched: false, reason: 'live_incomplete' });
    expect(db.rows('transcripts')).toHaveLength(0);
    // Sanity: a healthy Soniox meeting is still stitched, labelled soniox_realtime.
    db.tables.bot_runs[0]!.live_stt_fallback = null;
    expect(await stitchStuckRecording('rec-1', 'meet-1')).toMatchObject({ stitched: true });
    expect(db.rows('transcripts')[0]).toMatchObject({ transcription_provider: 'soniox_realtime' });
  });

  it('LIVE_STT_FALLBACK=off: reports and the watchdog are ignored (no automatic fallback handling)', async () => {
    process.env.LIVE_STT_FALLBACK = 'off';
    seedRun();
    const r = await new FakeSonioxService().authFails();
    expect(r.body.fallback).toBe('unsupported');
    expect(state()).toBeNull();
    expect(await fb.sweepNoSegments({ nowMs: BASE_MS + 1_000_000 })).toBe(0);
  });

  it('works before migration 030: the sink still stores segments, a failure report is acknowledged as unsupported, an alert counter moves', async () => {
    db.missing.add('bot_runs.live_stt_fallback');
    seedRun();
    const svc = new FakeSonioxService();
    expect((await svc.speak(0, 20)).status).toBe(200);
    expect(visible()).toHaveLength(4);
    const r = await svc.authFails();
    expect(r).toMatchObject({ status: 200, body: { fallback: 'unsupported' } });
    expect(fb.fallbackColumnIsMissing()).toBe(true);
    expect(metrics.getCounter('live_stt_fallback_unsupported')).toBeGreaterThan(0);
    expect(visible()).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('hot standby (Recall transcript runs hidden next to Soniox): failure switches to Recall without losing Soniox rows', () => {
  async function bothTalk(sonioxUntil: number, recallUntil: number) {
    const svc = new FakeSonioxService();
    if (sonioxUntil > 0) await svc.speak(0, sonioxUntil);
    for (let t = 0; t < recallUntil; t += 10) { advance(6); await recallWebhook(t, t + 9); }
    return svc;
  }

  it('Recall rows of a Soniox-primary run are stored hidden, trigger no insights, and Soniox rows stay the visible transcript', async () => {
    seedRun();
    await bothTalk(30, 30);
    expect(hidden().length).toBe(3);
    expect(hidden().every((r) => r.source_key === null || r.source_key === undefined)).toBe(true);
    expect(visible().every((r) => String(r.source_key).startsWith('live:'))).toBe(true);
    expect(queueInsightGeneration).toHaveBeenCalledTimes(1); // only the Soniox batch queued insights
    expect(state()).toBeNull();
  });

  it('silent stream: Recall hears 60 s of speech after the last Soniox segment -> switch at the last Soniox second, nothing lost, no overlap', async () => {
    seedRun();
    const svc = await bothTalk(40, 130);
    expect(state()).toMatchObject({ active: true, mode: 'recall', reason: 'silent' });
    const sw = state()!.switched_at_sec;
    expect(sw).toBe(39);
    const soniox = visible().filter((r) => String(r.source_key).startsWith('live:'));
    const recall = visible().filter((r) => !r.source_key);
    expect(soniox).toHaveLength(8); // every Soniox row received is still shown
    expect(soniox.every((r) => r.end_timestamp <= sw)).toBe(true);
    expect(recall.length).toBeGreaterThan(0);
    expect(recall.every((r) => r.start_timestamp >= sw)).toBe(true);
    // earlier Recall rows stay hidden (they would duplicate Soniox's)
    expect(hidden().every((r) => !r.source_key && r.start_timestamp < sw)).toBe(true);
    expect(queueInsightGeneration.mock.calls.length).toBeGreaterThan(1); // the switch re-queued insights
    expect(fb.liveStatusOf(state())).toBe('recall_fallback');

    // later Soniox rows (stream recovers on the service side) are kept but hidden; later Recall rows are visible
    const before = visible().length;
    await svc.speak(140, 160);
    expect(visible().length).toBe(before);
    expect(hidden().filter((r) => String(r.source_key).startsWith('live:'))).toHaveLength(4);
    advance(6);
    await recallWebhook(140, 149);
    expect(visible().length).toBe(before + 1);
  });

  it('no switch while Soniox keeps up, for short Recall utterances, or for a small gap', async () => {
    seedRun();
    const svc = new FakeSonioxService();
    await svc.speak(0, 100);
    advance(6); await recallWebhook(90, 99);
    expect(state()).toBeNull();
    // 2-word utterance far past Soniox: not evidence
    advance(6); await recallWebhook(300, 301, ['yes', 'ok']);
    expect(state()).toBeNull();
    // 30 s gap < 45 s
    advance(6); await recallWebhook(130, 135);
    expect(state()).toBeNull();
    // partial events never count
    advance(6); await recallWebhook(400, 410, 'this is a partial transcript event'.split(' '), 'transcript.partial_data');
    expect(state()).toBeNull();
  });

  it('connect failure with standby: switch at 0 s, every Recall row becomes visible', async () => {
    seedRun();
    const svc = new FakeSonioxService();
    for (let t = 0; t < 20; t += 10) { advance(6); await recallWebhook(t, t + 9); }
    expect(visible()).toHaveLength(0);
    const r = await svc.connectFails();
    expect(r.body.fallback).toBe('switched');
    expect(state()).toMatchObject({ mode: 'recall', reason: 'connect', switched_at_sec: 0 });
    expect(visible()).toHaveLength(2);
    advance(6); await recallWebhook(20, 29);
    expect(visible()).toHaveLength(3);
  });

  it('auth error with standby switches immediately', async () => {
    seedRun();
    await bothTalk(20, 20);
    const r = await new FakeSonioxService().authFails();
    expect(r.body.fallback).toBe('switched');
    expect(state()).toMatchObject({ mode: 'recall', reason: 'auth', switched_at_sec: 19 });
  });

  it('the stitched fallback transcript is allowed (Soniox then Recall, no hole) and labelled', async () => {
    seedRun();
    db.seed('recordings', { id: 'rec-1', meeting_id: 'meet-1', status: 'pending' });
    const svc = await bothTalk(20, 40);
    await svc.closesMidStream();
    expect(state()!.mode).toBe('recall');
    expect(await stitchStuckRecording('rec-1', 'meet-1')).toMatchObject({ stitched: true });
    expect(db.rows('transcripts')[0]).toMatchObject({ transcription_provider: 'soniox_recall_fallback' });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('sink: filler filter, schema, shadow and privacy', () => {
  it('drops junk and keeps real short answers; counts the drops; an all-junk batch stores nothing and still answers 200', async () => {
    seedRun();
    const svc = new FakeSonioxService();
    const r = await sink({ v: 1, ref: REF, sessionId: 's1', segments: [svc.seg(0, 1, 'Hmm.'), svc.seg(2, 3, 'Yes.'), svc.seg(4, 5, 'Mm'), svc.seg(6, 7, '...'), svc.seg(8, 9, 'No.'), svc.seg(10, 11, '42')] });
    expect(r.body).toMatchObject({ ok: true, inserted: 3, filtered: 3 });
    expect(visible().map((x) => x.segment_text).sort()).toEqual(['42', 'No.', 'Yes.']);
    expect(metrics.getCounter('live_stt_filler_dropped', { lang: 'en' })).toBe(3);
    const j = await svc.junk(100, 5, 'Hmm.');
    expect(j).toMatchObject({ status: 200, body: { inserted: 0, filtered: 5 } });
    expect(visible()).toHaveLength(3);
    expect(metrics.getCounter('live_stt_filler_dropped', { lang: 'en' })).toBe(8);
  });

  it('LIVE_STT_FILLER_FILTER=off stores everything', async () => {
    process.env.LIVE_STT_FILLER_FILTER = 'off';
    seedRun();
    await new FakeSonioxService().junk(0, 3);
    expect(visible()).toHaveLength(3);
  });

  it('shadow rows are stored exactly as received (never filtered)', async () => {
    seedRun({ live_stt_provider: 'shadow' });
    await new FakeSonioxService().junk(0, 3);
    expect(hidden()).toHaveLength(3);
    expect(hidden().every((r) => r.source_key.startsWith('shadow:'))).toBe(true);
  });

  it('a health report for a shadow run is ignored; unknown ref is 404; schema is strict', async () => {
    seedRun({ live_stt_provider: 'shadow' });
    expect((await new FakeSonioxService().authFails()).body).toMatchObject({ ok: true, ignored: true });
    expect(state()).toBeNull();
    const bad = [
      { v: 1, ref: REF, sessionId: 's', event: { type: 'stream_degraded', reason: 'because I said so' } },
      { v: 1, ref: REF, sessionId: 's', event: { type: 'stream_degraded', reason: 'closed', text: 'leak' } },
      { v: 1, ref: REF, sessionId: 's', event: { type: 'stream_ok', reason: 'closed' } },
      { v: 1, ref: REF, sessionId: 's' },
      { v: 1, ref: REF, sessionId: 's', segments: [], event: { type: 'stream_fatal', reason: 'auth' } },
      { v: 1, ref: REF, sessionId: 's', segments: [new FakeSonioxService().seg(0, 1, 'hello world')], event: { type: 'stream_fatal', reason: 'auth' } },
    ];
    for (const b of bad) expect((await sink(b)).status).toBe(400);
    db.tables.bot_runs = [];
    expect((await new FakeSonioxService().authFails()).status).toBe(404);
  });

  it('records segment lag and provider counters', async () => {
    seedRun();
    advance(12);
    await new FakeSonioxService().speak(0, 10); // arrives 12 s after join for speech that ended at 9 s -> ~3 s lag
    const snap = metrics.snapshot();
    expect(snap.latency['live_stt_segment_lag{provider=soniox}']).toMatchObject({ count: 1 });
    expect(snap.latency['live_stt_segment_lag{provider=soniox}']!.meanMs).toBeGreaterThan(2000);
    expect(metrics.getCounter('live_stt_segments_stored', { provider: 'soniox', hidden: 0 })).toBe(2);
  });

  it('logs and counters never contain transcript text, speaker names or secrets', async () => {
    seedRun();
    const svc = new FakeSonioxService();
    await svc.speak(0, 30);
    await svc.junk(40);
    advance(6); await recallWebhook(0, 9);
    await svc.closesMidStream();
    const all = logs.join('\n') + JSON.stringify(metrics.snapshot());
    for (const secret of ['soniox sentence', 'roadmap', 'Ada Soniox', 'Zed Recall', 'review the budget', 'Hmm', SECRET, REF]) expect(all).not.toContain(secret);
  });
});

describe('fallback decisions (pure)', () => {
  const cfg = fb.fallbackConfigFrom({});
  it('defaults: enabled, no hot standby, 45 s silence, 300 s no-segments, 3 words', () => {
    expect(cfg).toMatchObject({ enabled: true, hotStandby: false, silenceSec: 45, noSegmentsSec: 300, minRecallWords: 3 });
    expect(fb.fallbackConfigFrom({ LIVE_STT_RECALL_HOT_STANDBY: 'true', LIVE_STT_FALLBACK_SILENCE_SEC: '60' })).toMatchObject({ hotStandby: true, silenceSec: 60 });
    expect(fb.fallbackConfigFrom({ LIVE_STT_FALLBACK_SILENCE_SEC: '1' }).silenceSec).toBe(45); // below the floor: default
  });
  it('hot standby is for the allowlist stage only', () => {
    expect(fb.standbyAllowedFor({ hotStandby: true }, 'allowlist')).toBe(true);
    expect(fb.standbyAllowedFor({ hotStandby: true }, 'percent')).toBe(false);
    expect(fb.standbyAllowedFor({ hotStandby: false }, 'allowlist')).toBe(false);
  });
  it('decideSilentWithStandby', () => {
    expect(fb.decideSilentWithStandby({ recallEndSec: 100, recallWords: 5, lastSonioxEndSec: 40, cfg })).toBe(true);
    expect(fb.decideSilentWithStandby({ recallEndSec: 84, recallWords: 5, lastSonioxEndSec: 40, cfg })).toBe(false);
    expect(fb.decideSilentWithStandby({ recallEndSec: 100, recallWords: 2, lastSonioxEndSec: 40, cfg })).toBe(false);
    expect(fb.decideSilentWithStandby({ recallEndSec: 50, recallWords: 5, lastSonioxEndSec: null, cfg })).toBe(true); // Soniox never produced anything
    expect(fb.decideSilentWithStandby({ recallEndSec: 30, recallWords: 5, lastSonioxEndSec: null, cfg })).toBe(false);
  });
});

describe('fallback state helpers', () => {
  const cfg = fb.fallbackConfigFrom({});
  it('decideNoSegments', () => {
    expect(fb.decideNoSegments({ nowMs: 400_000, inCallSinceMs: 0, hasAnySonioxSegment: false, cfg })).toBe(true);
    expect(fb.decideNoSegments({ nowMs: 200_000, inCallSinceMs: 0, hasAnySonioxSegment: false, cfg })).toBe(false);
    expect(fb.decideNoSegments({ nowMs: 400_000, inCallSinceMs: 0, hasAnySonioxSegment: true, cfg })).toBe(false);
    expect(fb.decideNoSegments({ nowMs: 400_000, inCallSinceMs: null, hasAnySonioxSegment: false, cfg })).toBe(false);
  });
  it('parseFallbackState rejects garbage and clamps unknown reasons', () => {
    for (const bad of [null, undefined, 5, 'x', {}, { v: 2 }, { v: 1, active: 'yes', mode: 'recall' }, { v: 1, active: true, mode: 'other' }]) expect(fb.parseFallbackState(bad)).toBeNull();
    expect(fb.parseFallbackState({ v: 1, active: true, mode: 'recall', reason: 'weird', switched_at_sec: 3 })).toMatchObject({ reason: 'error', retries_used: 0, switched_at_sec: 3 });
  });
  it('status and incompleteness', () => {
    const mk = (mode: 'recall' | 'unavailable', active: boolean) => fb.parseFallbackState({ v: 1, active, mode, reason: 'closed', switched_at_sec: 1, retries_used: 0, events: [] });
    expect(fb.liveStatusOf(null)).toBe('ok');
    expect(fb.liveStatusOf(mk('recall', true))).toBe('recall_fallback');
    expect(fb.liveStatusOf(mk('unavailable', true))).toBe('unavailable');
    expect(fb.liveStatusOf(mk('unavailable', false))).toBe('ok');
    expect(fb.liveTranscriptIsIncomplete(null)).toBe(false);
    expect(fb.liveTranscriptIsIncomplete(mk('unavailable', false))).toBe(true); // recovered, but there is a gap
    expect(fb.liveTranscriptIsIncomplete(mk('recall', true))).toBe(false);
  });
});
