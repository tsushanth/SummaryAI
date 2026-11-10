import WebSocket from 'ws';
import { mintIngestToken } from '../../src/auth.js';
import { IngestServer } from '../../src/server.js';
import type { SessionConfig } from '../../src/session.js';
import { HttpSink } from '../../src/sink/httpSink.js';
import { SonioxEngine } from '../../src/stt/soniox.js';
import { FakeBackend, type StoredRow } from '../helpers/fakeBackend.js';
import { FakeSoniox, type FakeSonioxOptions } from '../helpers/fakeSoniox.js';
import { PEOPLE, type Fixture } from './fixture.js';

/**
 * Replay harness: a simulated Recall bot dials the real IngestServer (real websocket, real Soniox client, real HttpSink),
 * which talks to a FAKE Soniox (or the real one when engine === 'real') and posts to a fake backend that checks the HMAC.
 * The Recall side speaks the documented envelope: audio_mixed_raw.data (base64 s16le 16 kHz mono, 200 ms) and
 * participant_events.speech_on / speech_off, paced at `speed` x real time.
 */

const SECRET = 'replay-secret';
const SINK_SECRET = 'replay-sink-secret';
const REF = '11111111-2222-4333-8444-555555555555';
const BOT = 'bot-replay-1';
export const REPLAY_CONTROL_SECRET = 'replay-control-secret';
export const REPLAY_REF = REF;

export interface ReplayOptions {
  fixture: Fixture;
  engine: 'fake' | 'real';
  speed: number;
  fake?: Partial<FakeSonioxOptions>;
  /** Terminate our first Soniox socket once this much audio has been sent (works for fake and real). */
  cutClientAtAudioMs?: number;
  session?: Partial<SessionConfig>;
  /** speech_on lags the true start by this much (Recall's active-speaker events do). */
  speechOnLagMs?: number;
  backendFailFirst?: number;
  /** Extra query string on the simulated Recall websocket URL, e.g. '&lang=fr'. */
  ingestQuery?: string;
  /** Run once when the simulated meeting reaches `atAudioMs` (e.g. POST /control/language). */
  actions?: { atAudioMs: number; run: (ctx: { server: IngestServer; port: number; ref: string; controlSecret: string }) => Promise<void> | void }[];
  maxStreams?: number;
  sonioxEndpointDetection?: boolean;
  /** Real-engine config source. */
  sonioxApiKey?: string;
  log?: (s: string) => void;
}

export interface SegmentOut extends StoredRow { }

export interface ReplayReport {
  engine: 'fake' | 'real';
  speed: number;
  audioMs: number;
  rows: SegmentOut[];
  metrics: Record<string, unknown>;
  expectedWords: string[];
  receivedWords: string[];
  wordsMissing: number;
  wordsExtra: number;
  wordLossPct: number;
  orderOk: boolean;
  seqOk: boolean;
  duplicateKeys: number;
  speakerWordAccuracy: number;
  speakerWrong: { text: string; got: string; want: string }[];
  audioCoveragePct: number | null;
  reconnects: number;
  streams: number;
  maxBufferedBytes: number;
  heapGrowthMb: number;
  unhandled: string[];
  backendBadSignatures: number;
  backendRequests: number;
  /** Median/p90 delay from the end of a segment's last word (audio time) to its arrival at the backend, in AUDIO seconds. */
  segmentDelayP50s: number;
  segmentDelayP90s: number;
  fakeStreams?: { config: Record<string, unknown> | null; index: number; closedBy: string; processedMs: number; keepalives: number; sawApiKeyInFrame: boolean; sawBearerHeader: boolean }[];
}

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '');

function lcs(a: string[], b: string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
  return dp[a.length]![b.length]!;
}

const pct = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]! : NaN);

export async function runReplay(o: ReplayOptions): Promise<ReplayReport> {
  const unhandled: string[] = [];
  const onUnhandled = (e: unknown) => { unhandled.push(String((e as Error)?.message ?? e)); };
  process.on('unhandledRejection', onUnhandled);

  const backend = new FakeBackend(SINK_SECRET);
  await backend.start();
  backend.failNext = o.backendFailFirst ?? 0;
  const fake = o.engine === 'fake' ? new FakeSoniox({ fixture: o.fixture, ...o.fake }) : null;
  if (fake) await fake.start();

  const sockets: WebSocket[] = [];
  const engine = new SonioxEngine({
    apiKey: o.engine === 'real' ? (o.sonioxApiKey ?? '') : 'fake-key',
    url: fake?.url,
    endpointDetection: o.sonioxEndpointDetection ?? true,
    onSocket: (ws) => sockets.push(ws),
  });
  const server = new IngestServer({
    ingestSecrets: [SECRET], controlSecrets: [REPLAY_CONTROL_SECRET], engine, sink: new HttpSink({ url: backend.url, secret: SINK_SECRET }),
    maxStreams: o.maxStreams ?? 3, maxSessions: 3, recallGraceMs: 300,
    session: { idleFlushMs: Math.max(200, Math.round(1500 / o.speed)), terms: ['Alice', 'Bob'], ...o.session },
  });
  const port = await server.listen(0, '127.0.0.1');

  const heap0 = process.memoryUsage().heapUsed;
  let heapMax = heap0;
  let maxBuffered = 0;
  const sampler = setInterval(() => {
    heapMax = Math.max(heapMax, process.memoryUsage().heapUsed);
    const s = server.sessions.get(REF)?.session;
    if (s) maxBuffered = Math.max(maxBuffered, s.debug().bufferedBytes);
  }, 50);

  // ------------------------------------------------------------------ simulated Recall bot
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ingest/${REF}/?token=${mintIngestToken(SECRET, REF)}${o.ingestQuery ?? ''}`);
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });

  const lag = o.speechOnLagMs ?? 300;
  const events: { atMs: number; on: boolean; who: 'alice' | 'bob' }[] = [];
  for (const u of o.fixture.utterances) {
    events.push({ atMs: u.startMs + lag, on: true, who: u.who });
    events.push({ atMs: u.endMs + 100, on: false, who: u.who });
  }
  events.sort((a, b) => a.atMs - b.atMs);
  const speechMsg = (e: (typeof events)[number]) => JSON.stringify({
    event: e.on ? 'participant_events.speech_on' : 'participant_events.speech_off',
    data: {
      data: { participant: { id: Number(PEOPLE[e.who].id), name: PEOPLE[e.who].name, is_host: PEOPLE[e.who].isHost, platform: 'google_meet', extra_data: null, email: null }, timestamp: { absolute: new Date(0).toISOString(), relative: e.atMs / 1000 }, data: null },
      bot: { id: BOT, metadata: {} },
    },
  });

  const pcm = o.fixture.pcm;
  const CH = 6400;
  const t0 = Date.now();
  const sendWall: number[] = [];
  let ei = 0;
  let cut = false;
  const pendingActions = [...(o.actions ?? [])].sort((a, b) => a.atAudioMs - b.atAudioMs);
  const actionRuns: Promise<void>[] = [];
  for (let i = 0, off = 0; off < pcm.length; i++, off += CH) {
    const relMs = i * 200;
    while (ei < events.length && events[ei]!.atMs <= relMs) ws.send(speechMsg(events[ei++]!));
    ws.send(JSON.stringify({
      event: 'audio_mixed_raw.data',
      data: { data: { buffer: pcm.subarray(off, off + CH).toString('base64'), timestamp: { relative: relMs / 1000, absolute: new Date(relMs).toISOString() } }, bot: { id: BOT, metadata: {} } },
    }));
    sendWall.push(Date.now());
    while (pendingActions.length && pendingActions[0]!.atAudioMs <= relMs) {
      const a = pendingActions.shift()!;
      actionRuns.push(Promise.resolve(a.run({ server, port, ref: REF, controlSecret: REPLAY_CONTROL_SECRET })).then(() => undefined));
    }
    if (!cut && o.cutClientAtAudioMs !== undefined && relMs >= o.cutClientAtAudioMs && sockets.some((x) => x.readyState === WebSocket.OPEN)) { cut = true; sockets.filter((x) => x.readyState === WebSocket.OPEN)[0]!.terminate(); }
    const due = t0 + ((i + 1) * 200) / o.speed;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  await Promise.all(actionRuns);
  ws.close();

  // Recall hangs up: the session closes after the grace period, finalizing the stream and draining the sink.
  const deadline = Date.now() + 30_000;
  while ((server.sessions.size > 0 || server.limiter.inUse() > 0) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 100));

  clearInterval(sampler);
  const lastMetrics: Record<string, unknown> | null = server.closedMetrics[0] ?? null;

  const rows = backend.rows;
  const expected = o.fixture.utterances.flatMap((u) => u.words.map((w) => norm(w.text))).filter(Boolean);
  const received = rows.flatMap((r) => r.words as { text: string }[]).map((w) => norm(w.text)).filter(Boolean);
  const common = lcs(expected, received);
  // Speaker accuracy per received word: truth = utterance containing the word's midpoint.
  let right = 0, total = 0;
  const wrong: { text: string; got: string; want: string }[] = [];
  for (const r of rows) {
    for (const w of r.words as { text: string; start_timestamp: { relative: number }; end_timestamp: { relative: number } }[]) {
      const mid = ((w.start_timestamp.relative + w.end_timestamp.relative) / 2) * 1000;
      const u = o.fixture.utterances.find((x) => mid >= x.startMs - 100 && mid <= x.endMs + 100);
      if (!u) continue;
      total++;
      if (r.speaker_name === PEOPLE[u.who].name) right++;
      else if (wrong.length < 8) wrong.push({ text: w.text, got: r.speaker_name, want: PEOPLE[u.who].name });
    }
  }
  const keys = new Set(rows.map((r) => r.key));
  const delays: number[] = [];
  for (const r of rows) {
    const idx = Math.min(sendWall.length - 1, Math.max(0, Math.floor(r.end_timestamp / 0.2)));
    delays.push(((r.arrivedAt - (sendWall[idx] ?? r.arrivedAt)) * o.speed) / 1000);
  }
  const covered = fake ? fake.coveredBlocks() : null;
  const totalBlocks = Math.floor(pcm.length / CH);
  const report: ReplayReport = {
    engine: o.engine, speed: o.speed, audioMs: o.fixture.durationMs, rows,
    metrics: lastMetrics ?? {},
    expectedWords: expected, receivedWords: received,
    wordsMissing: expected.length - common, wordsExtra: received.length - common,
    wordLossPct: ((expected.length - common) / expected.length) * 100,
    orderOk: rows.every((r, i) => i === 0 || r.start_timestamp >= rows[i - 1]!.start_timestamp - 0.001),
    seqOk: rows.every((r, i) => i === 0 || r.seq > rows[i - 1]!.seq),
    duplicateKeys: rows.length - keys.size,
    speakerWordAccuracy: total ? right / total : 0, speakerWrong: wrong,
    audioCoveragePct: covered ? (Array.from({ length: totalBlocks }, (_, i) => i).filter((i) => covered.has(i)).length / totalBlocks) * 100 : null,
    reconnects: Number(lastMetrics?.reconnects ?? 0),
    streams: fake ? fake.streams.length : sockets.length,
    maxBufferedBytes: maxBuffered,
    heapGrowthMb: (heapMax - heap0) / 1048576,
    unhandled, backendBadSignatures: backend.badSignatures, backendRequests: backend.requests,
    segmentDelayP50s: pct(delays, 0.5), segmentDelayP90s: pct(delays, 0.9),
    fakeStreams: fake?.streams.map((s) => ({ config: s.config, index: s.index, closedBy: s.closedBy, processedMs: s.processedMs, keepalives: s.keepalives, sawApiKeyInFrame: s.sawApiKeyInFrame, sawBearerHeader: s.sawBearerHeader })),
  };
  await server.stop();
  await fake?.stop();
  await backend.stop();
  process.off('unhandledRejection', onUnhandled);
  return report;
}
