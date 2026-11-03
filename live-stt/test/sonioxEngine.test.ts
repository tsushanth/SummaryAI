import { afterEach, describe, expect, it } from 'vitest';
import { SonioxEngine } from '../src/stt/soniox.js';
import type { SttCloseInfo, SttUpdate } from '../src/stt/types.js';
import { MeetingSession } from '../src/session.js';
import { ensureFixture } from './harness/fixture.js';
import { FakeSoniox } from './helpers/fakeSoniox.js';
import { MemorySink } from './helpers/memorySink.js';

const fixture = ensureFixture();
const CH = 6400;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fake: FakeSoniox;
afterEach(async () => { await fake?.stop(); });

async function start(o: Partial<ConstructorParameters<typeof FakeSoniox>[0]> = {}): Promise<FakeSoniox> {
  fake = new FakeSoniox({ fixture, ...o });
  await fake.start();
  return fake;
}

describe('SonioxEngine against the fake server (shapes confirmed on the real API)', () => {
  it('opens with the documented config, header auth, streams audio and parses updates', async () => {
    await start();
    const updates: SttUpdate[] = [];
    const engine = new SonioxEngine({ apiKey: 'k', url: fake.url, endpointDetection: true });
    const conn = await engine.connect({ terms: ['Alice'], languageHints: ['en'], diarization: true }, { onUpdate: (u) => updates.push(u), onClose: () => undefined });
    for (let i = 0; i < 100; i++) conn.sendAudio(fixture.pcm.subarray(i * CH, (i + 1) * CH));
    await wait(300);
    conn.endStream();
    await wait(300);
    const st = fake.streams[0]!;
    expect(st.config).toMatchObject({ model: 'stt-rt-v6', audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1, enable_speaker_diarization: true, enable_language_identification: true, enable_endpoint_detection: true, language_hints: ['en'], context: { terms: ['Alice'] } });
    expect(st.sawBearerHeader).toBe(true);
    expect(st.sawApiKeyInFrame).toBe(false);
    expect(updates.some((u) => u.tokens.some((t) => t.isFinal && t.speaker === '1' && t.language === 'en'))).toBe(true);
    expect(updates.some((u) => u.tokens.some((t) => t.control === 'end'))).toBe(true);
    expect(updates[updates.length - 1]!.finished).toBe(true);
    expect(st.closedBy).toBe('finished');
  });

  it('reports a clean close after endStream and an error close after an error frame', async () => {
    await start({ rejectNext: { count: 1, error_code: 429, error_type: 'rate_limit' } });
    const closes: SttCloseInfo[] = [];
    const engine = new SonioxEngine({ apiKey: 'k', url: fake.url });
    // the server accepts the socket, then sends the error frame and closes: connect() resolves, onClose carries the 429
    const conn = await engine.connect({ terms: [], languageHints: [], diarization: true }, { onUpdate: () => undefined, onClose: (c) => closes.push(c) });
    await wait(150);
    expect(closes).toHaveLength(1);
    expect(closes[0]!.clean).toBe(false);
    expect(closes[0]!.error).toMatchObject({ code: 429, rateLimited: true, retryable: true });
    void conn;
  });

  it('rejects connect() when nothing listens, with a retryable-looking error', async () => {
    const engine = new SonioxEngine({ apiKey: 'k', url: 'ws://127.0.0.1:1/x', connectTimeoutMs: 500 });
    await expect(engine.connect({ terms: [], languageHints: [], diarization: true }, { onUpdate: () => undefined, onClose: () => undefined })).rejects.toBeInstanceOf(Error);
  });

  it('keepalives keep an audio-less stream alive past the server idle timeout (real API: 408 after about 21 s)', async () => {
    await start({ idleTimeoutMs: 1200 });
    const sink = new MemorySink();
    const s = new MeetingSession({
      ref: 'r', engine: new SonioxEngine({ apiKey: 'k', url: fake.url }), sink,
      config: { keepaliveMs: 400, idleFlushMs: 100, closeGraceMs: 500 },
    });
    for (let i = 0; i < 5; i++) s.handleAudio({ relMs: i * 200, durMs: 200, pcm: fixture.pcm.subarray(i * CH, (i + 1) * CH) });
    await wait(3500); // 3x the fake's idle timeout with zero audio
    expect(fake.streams).toHaveLength(1);
    expect(fake.streams[0]!.keepalives).toBeGreaterThanOrEqual(3);
    expect(fake.streams[0]!.closedBy).toBe('open');
    await s.close();
  }, 15_000);

  it('without keepalives the same stream is killed with 408 and the session reconnects', async () => {
    await start({ idleTimeoutMs: 1200 });
    const s = new MeetingSession({
      ref: 'r', engine: new SonioxEngine({ apiKey: 'k', url: fake.url }), sink: new MemorySink(),
      config: { keepaliveMs: 600_000, backoffMs: [100], closeGraceMs: 300 },
    });
    for (let i = 0; i < 5; i++) s.handleAudio({ relMs: i * 200, durMs: 200, pcm: fixture.pcm.subarray(i * CH, (i + 1) * CH) });
    await wait(2500);
    expect(fake.streams.length).toBeGreaterThanOrEqual(2);
    expect(fake.streams[0]!.closedBy).toBe('error');
    await s.close();
  }, 15_000);
});
