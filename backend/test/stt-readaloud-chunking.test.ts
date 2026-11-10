// Self-hosted Whisper adapter: splitting long PCM WAV input into parts, time offsets, speaker policy, inputs it declines.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const alerts = { failure: vi.fn(), http: vi.fn() };
vi.mock('../src/lib/alerts.js', () => ({
  reportAlert: vi.fn(),
  reportProviderFailure: (...a: any[]) => alerts.failure(...a),
  reportProviderHttpFailure: (...a: any[]) => alerts.http(...a),
}));

const mod = await import('../src/services/stt/readaloudProvider.js');
const { createReadaloudProvider, readWavInfo, buildWavHeader, planParts, planReadaloudInput, stitchParts, ChunkedSpeakerIdentityError, READALOUD_MAX_PART_SECONDS } = mod;

/** PCM WAV; sample i of the data holds the value i % 251 (so a part can be checked against the original bytes). */
function wav(seconds: number, opts: { rate?: number; channels?: number; bits?: number; declared?: number | 'streamed'; extraChunk?: boolean } = {}): Blob {
  const rate = opts.rate ?? 100, channels = opts.channels ?? 1, bits = opts.bits ?? 16;
  const blockAlign = channels * (bits / 8);
  const frames = Math.round(seconds * rate);
  const data = Buffer.alloc(frames * blockAlign);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const extra = opts.extraChunk ? Buffer.concat([Buffer.from('LIST'), Buffer.from([3, 0, 0, 0]), Buffer.from('abc'), Buffer.from([0])]) : Buffer.alloc(0); // odd-sized, padded
  const head = Buffer.from(buildWavHeader({ sampleRate: rate, channels, bitsPerSample: bits, blockAlign }, data.length));
  const declared = opts.declared === 'streamed' ? 0xffffffff : opts.declared ?? data.length;
  const fmtAndRiff = head.subarray(0, 36);
  const dataHdr = Buffer.alloc(8); dataHdr.write('data', 0, 'ascii'); dataHdr.writeUInt32LE(declared >>> 0, 4);
  return new Blob([fmtAndRiff, extra, dataHdr, data]);
}

const utt = (speaker: number, start: number, end: number, text: string) => ({ speaker, start, end, transcript: text, confidence: 0.9 });
const respond = (utterances: any[], opts: { lang?: string; duration?: number } = {}) => ({
  metadata: { duration: opts.duration ?? 8 },
  results: { channels: [{ detected_language: opts.lang ?? 'en', alternatives: [{ transcript: utterances.map((u) => u.transcript).join(' ') }] }], utterances },
});
const ok = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

const sent: { url: string; body: Blob; headers: any }[] = [];
function stubFetch(impl: (i: number) => any) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { sent.push({ url, body: init.body, headers: init.headers }); return impl(sent.length - 1); }));
}
const mk = (maxPartSeconds = 10) => createReadaloudProvider({ baseUrl: 'https://worker.example', token: 't', maxPartSeconds });

beforeEach(() => { sent.length = 0; alerts.failure.mockReset(); alerts.http.mockReset(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('WAV header reading', () => {
  it('reads a plain PCM WAV', async () => {
    const info = await readWavInfo(wav(25));
    expect(info).toMatchObject({ sampleRate: 100, channels: 1, bitsPerSample: 16, blockAlign: 2, dataOffset: 44, dataBytes: 5000, durationSeconds: 25 });
  });
  it('skips other chunks, including odd-sized ones that are padded', async () => {
    const info = await readWavInfo(wav(5, { extraChunk: true }));
    expect(info).toMatchObject({ dataOffset: 44 + 12, durationSeconds: 5 });
  });
  it('a streamed file (length 0xFFFFFFFF) uses the bytes that are there; a too-large declared length is clamped', async () => {
    expect((await readWavInfo(wav(5, { declared: 'streamed' })))!.durationSeconds).toBe(5);
    expect((await readWavInfo(wav(5, { declared: 999999 })))!.durationSeconds).toBe(5);
  });
  it('stereo 24-bit keeps whole frames only', async () => {
    const blob = wav(2, { channels: 2, bits: 24, rate: 50, declared: 'streamed' });
    const info = (await readWavInfo(new Blob([blob, Buffer.from([1, 2, 3, 4, 5])])))!; // length unknown + a partial frame at the end
    expect(info.blockAlign).toBe(6);
    expect(info.dataBytes % 6).toBe(0);
    expect(info.durationSeconds).toBe(2);
  });
  it.each([
    ['not RIFF', new Blob(['hello world, this is not audio at all'])],
    ['RIFF but not WAVE', new Blob([Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI '), Buffer.alloc(40)])])],
    ['empty', new Blob([])],
  ])('%s -> null', async (_n, blob) => { expect(await readWavInfo(blob)).toBeNull(); });
  it('float samples (format 3) are not split -> null', async () => {
    const b = Buffer.from(await wav(1).arrayBuffer());
    b.writeUInt16LE(3, 20);
    expect(await readWavInfo(new Blob([b]))).toBeNull();
  });
  it('block align that does not match channels x bytes per sample -> null', async () => {
    const b = Buffer.from(await wav(1).arrayBuffer());
    b.writeUInt16LE(7, 32);
    expect(await readWavInfo(new Blob([b]))).toBeNull();
  });
});

describe('planParts', () => {
  it('splits into equal parts no longer than the limit, on sample boundaries, with exact offsets', () => {
    const parts = planParts({ dataBytes: 5000, blockAlign: 2, sampleRate: 100 }, 10); // 25 s
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.start)).toEqual([0, 1668, 3336]);
    expect(parts.map((p) => p.end)).toEqual([1668, 3336, 5000]);
    expect(parts.every((p) => p.start % 2 === 0 && p.end % 2 === 0)).toBe(true);
    expect(parts.every((p) => p.durationSeconds <= 10)).toBe(true);
    expect(parts.map((p) => p.offsetSeconds)).toEqual([0, 8.34, 16.68]);
    expect(parts.reduce((n, p) => n + (p.end - p.start), 0)).toBe(5000); // no byte lost or repeated
  });
  it('100 minutes at the default limit -> two parts of 50 minutes (not 55 + 45)', () => {
    const rate = 16000, bytes = 100 * 60 * rate * 2;
    const parts = planParts({ dataBytes: bytes, blockAlign: 2, sampleRate: rate });
    expect(parts).toHaveLength(2);
    expect(parts[0]!.durationSeconds).toBe(3000);
    expect(parts[1]!.offsetSeconds).toBe(3000);
    expect(READALOUD_MAX_PART_SECONDS).toBe(3300);
  });
  it('a recording within the limit is one part', () => {
    expect(planParts({ dataBytes: 1000, blockAlign: 2, sampleRate: 100 }, 10)).toHaveLength(1);
  });
});

describe('planReadaloudInput', () => {
  it('short WAV -> single request', async () => { expect(await planReadaloudInput(wav(8), 'a.wav', {}, 10)).toEqual({ kind: 'single' }); });
  it('long WAV -> parts', async () => { expect((await planReadaloudInput(wav(25), 'a.wav', {}, 10)).kind).toBe('parts'); });
  it('too many parts -> skip', async () => { expect(await planReadaloudInput(wav(25), 'a.wav', {}, 3)).toEqual({ kind: 'skip', reason: 'recording_too_long' }); });
  it('mp3/m4a with a length hint above one request -> skip (cannot be split here)', async () => {
    expect(await planReadaloudInput(new Blob(['x']), 'a.mp3', { durationHintSeconds: 6000 }, READALOUD_MAX_PART_SECONDS)).toEqual({ kind: 'skip', reason: 'long_recording_format_not_splittable' });
  });
  it('mp3/m4a with a short hint, no hint, or a nonsense hint -> single', async () => {
    for (const hint of [600, undefined, NaN, -5]) expect(await planReadaloudInput(new Blob(['x']), 'a.m4a', { durationHintSeconds: hint as any })).toEqual({ kind: 'single' });
  });
  it('a .wav that is not a readable PCM WAV is treated like any other format', async () => {
    expect((await planReadaloudInput(new Blob(['junk']), 'a.wav', { durationHintSeconds: 99999 })).kind).toBe('skip');
    expect((await planReadaloudInput(new Blob(['junk']), 'a.wav', {})).kind).toBe('single');
  });
  it('the WAV header wins over a wrong client-reported length', async () => {
    expect((await planReadaloudInput(wav(8), 'a.wav', { durationHintSeconds: 99999 }, 10)).kind).toBe('single');
  });
  it('precheck mirrors the plan and never throws', async () => {
    const p = mk(10);
    expect(await p.precheck!(new Blob(['x']), 'a.mp3', { durationHintSeconds: 99999 })).toBe('long_recording_format_not_splittable');
    expect(await p.precheck!(wav(25), 'a.wav', {})).toBeNull();
    expect(await p.precheck!(null as any, 'a.wav', {})).toBeNull();
  });
});

describe('long WAV through the provider', () => {
  it('sends each part as a valid WAV (rewritten header, exact slice of the original bytes), in order, then stitches with offsets', async () => {
    const original = wav(25);
    const originalBytes = Buffer.from(await original.arrayBuffer());
    stubFetch((i) => ok(respond([utt(0, 0.5, 2, `part${i} first`), utt(0, 4, 7.9, `part${i} second`)], { duration: [8.34, 8.34, 8.32][i] })));
    const r = await mk(10).transcribe(original, 'u/rec.wav');

    expect(sent).toHaveLength(3);
    for (const [i, s] of sent.entries()) {
      expect(s.url).toContain('/v1/listen?diarize=true&utterances=true');
      expect(s.headers['Content-Type']).toBe('audio/wav');
      const buf = Buffer.from(await s.body.arrayBuffer());
      const info = (await readWavInfo(new Blob([buf])))!;
      expect(info).toMatchObject({ sampleRate: 100, channels: 1, bitsPerSample: 16, dataOffset: 44 });
      expect(buf.readUInt32LE(4)).toBe(36 + info.dataBytes); // RIFF size
      expect(buf.readUInt32LE(40)).toBe(info.dataBytes); // data chunk size, written explicitly (a reader must not have to guess)
      expect(info.dataBytes).toBe([1668, 1668, 1664][i]);
      const expectedStart = [0, 1668, 3336][i]!, expectedEnd = [1668, 3336, 5000][i]!;
      expect(buf.subarray(44).equals(originalBytes.subarray(44 + expectedStart, 44 + expectedEnd))).toBe(true);
    }
    expect(r.segments.map((s) => [s.text, s.start_time, s.end_time])).toEqual([
      ['part0 first', 0.5, 2], ['part0 second', 4, 7.9],
      ['part1 first', 8.84, 10.34], ['part1 second', 12.34, 16.24],
      ['part2 first', 17.18, 18.68], ['part2 second', 20.68, 24.58],
    ].map(([t, a, b]) => [t, expect.closeTo(a as number, 6), expect.closeTo(b as number, 6)]));
    expect(r.fullText).toBe('part0 first part0 second part1 first part1 second part2 first part2 second');
    expect(r.wordCount).toBe(12);
    expect(r.durationSeconds).toBeCloseTo(25, 5);
    expect(r.speakerCount).toBe(1);
    expect(new Set(r.segments.map((s) => s.speaker_index))).toEqual(new Set([0]));
    expect(new Set(r.segments.map((s) => s.id)).size).toBe(6);
  });

  it('each request reuses the language pin and keyterms', async () => {
    stubFetch(() => ok(respond([utt(0, 0, 1, 'hola')], { lang: 'es' })));
    await mk(10).transcribe(wav(25), 'a.wav', { languageHints: ['es'], terms: ['Acme'] });
    expect(sent).toHaveLength(3);
    for (const s of sent) { expect(s.url).toContain('language=es'); expect(s.url).toContain('keyterm=Acme'); }
  });

  it('a short WAV is one request with the original body, unchanged', async () => {
    const w = wav(8);
    stubFetch(() => ok(respond([utt(0, 0, 1, 'hi')])));
    await mk(10).transcribe(w, 'a.wav');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toBe(w);
  });

  it('single speaker per part but with different speaker numbers is merged as one speaker 0', async () => {
    stubFetch((i) => ok(respond([utt(i + 1, 0, 1, `w${i}`)])));
    const r = await mk(10).transcribe(wav(25), 'a.wav');
    expect(r.speakerCount).toBe(1);
    expect(r.segments.every((s) => s.speaker_index === 0 && s.speaker_label === 'Speaker 0')).toBe(true);
  });

  it('a part with several speakers is refused by default (speakers cannot be matched across parts) and stops early', async () => {
    stubFetch(() => ok(respond([utt(0, 0, 1, 'a'), utt(1, 1, 2, 'b')])));
    await expect(mk(10).transcribe(wav(25), 'a.wav')).rejects.toBeInstanceOf(ChunkedSpeakerIdentityError);
    expect(sent).toHaveLength(1); // the remaining parts were not transcribed
  });

  it('with allowChunkLocalSpeakers: speaker indexes are unique per part, labelled by part, count is the largest part', async () => {
    stubFetch((i) => ok(respond(i === 1 ? [utt(0, 0, 1, 'a'), utt(2, 1, 2, 'b'), utt(0, 2, 3, 'c')] : [utt(0, 0, 1, 'x')])));
    const r = await mk(10).transcribe(wav(25), 'a.wav', { allowChunkLocalSpeakers: true });
    expect(r.segments.map((s) => [s.speaker_index, s.speaker_label])).toEqual([
      [0, 'Part 1 speaker 0'], [1, 'Part 2 speaker 0'], [2, 'Part 2 speaker 1'], [1, 'Part 2 speaker 0'], [3, 'Part 3 speaker 0'],
    ]);
    expect(r.speakerCount).toBe(2);
  });

  it('an HTTP error on any part fails the whole call (no partial transcript)', async () => {
    stubFetch((i) => (i === 1 ? { ok: false, status: 413, text: async () => 'too long', json: async () => ({}) } : ok(respond([utt(0, 0, 1, 'a')]))));
    await expect(mk(10).transcribe(wav(25), 'a.wav')).rejects.toMatchObject({ status: 413 });
    expect(alerts.http).toHaveBeenCalledWith('readaloud', 413);
    expect(sent).toHaveLength(2);
  });

  it('the whole call shares one deadline across parts', async () => {
    vi.useFakeTimers();
    try {
      stubFetch(async () => { await vi.advanceTimersByTimeAsync(40); return ok(respond([utt(0, 0, 1, 'a')])); });
      const p = mk(10).transcribe(wav(25), 'a.wav', { timeoutMs: 50 });
      const caught = p.catch((e) => e);
      await vi.advanceTimersByTimeAsync(200);
      const e = await caught;
      expect(e).toMatchObject({ name: 'TimeoutError' });
      expect(sent.length).toBeLessThan(3);
    } finally { vi.useRealTimers(); }
  });

  it('silent parts are skipped in the text; all-silent returns an empty transcript (not an error)', async () => {
    stubFetch((i) => ok(i === 1 ? respond([]) : respond([utt(0, 0, 1, 'word')])));
    const r = await mk(10).transcribe(wav(25), 'a.wav');
    expect(r.fullText).toBe('word word');
    stubFetch(() => ok(respond([])));
    const e = await mk(10).transcribe(wav(25), 'a.wav');
    expect(e).toMatchObject({ fullText: '', wordCount: 0, segments: [], speakerCount: 1 });
  });

  it('declines a non-WAV file the caller says is too long, without any request', async () => {
    stubFetch(() => ok(respond([utt(0, 0, 1, 'a')])));
    await expect(mk().transcribe(new Blob(['x']), 'a.mp3', { durationHintSeconds: 7000 })).rejects.toMatchObject({ skipReason: 'long_recording_format_not_splittable' });
    expect(sent).toHaveLength(0);
  });

  it('does not copy the whole input per part: the body is a Blob built from a slice, not a Buffer of the recording', async () => {
    stubFetch(() => ok(respond([utt(0, 0, 1, 'a')])));
    await mk(10).transcribe(wav(25), 'a.wav');
    for (const s of sent) expect(s.body).toBeInstanceOf(Blob);
    expect(sent[0]!.body.size).toBeLessThan(1700 + 44 + 1);
  });
});

describe('stitchParts (pure)', () => {
  const t = (segs: [number, number, number, string][], over: any = {}) => ({
    segments: segs.map(([sp, a, b, text]) => ({ id: 'i', speaker_label: `Speaker ${sp}`, speaker_index: sp, text, start_time: a, end_time: b, confidence: 0.9 })),
    fullText: segs.map((s) => s[3]).join(' '), wordCount: segs.length, speakerCount: 1, detectedLanguage: 'en', durationSeconds: 10, ...over,
  });
  it('offsets times, joins text, sums measured durations', () => {
    const r = stitchParts([{ transcript: t([[0, 1, 2, 'a']]), offsetSeconds: 0 }, { transcript: t([[0, 1, 2, 'b']]), offsetSeconds: 3000 }], 6000, false);
    expect(r.segments.map((s) => [s.start_time, s.end_time])).toEqual([[1, 2], [3001, 3002]]);
    expect(r.fullText).toBe('a b');
    expect(r.durationSeconds).toBe(20);
  });
  it('refuses to merge multi-speaker parts unless part-local speakers are accepted', () => {
    const multi = t([[0, 0, 1, 'a'], [1, 1, 2, 'b']], { speakerCount: 2 });
    expect(() => stitchParts([{ transcript: multi, offsetSeconds: 0 }, { transcript: t([[0, 0, 1, 'c']]), offsetSeconds: 10 }], null, false)).toThrow(ChunkedSpeakerIdentityError);
    const r = stitchParts([{ transcript: multi, offsetSeconds: 0 }, { transcript: t([[0, 0, 1, 'c']]), offsetSeconds: 10 }], null, true);
    expect(r.segments.map((s) => s.speaker_index)).toEqual([0, 1, 2]);
    expect(r.speakerCount).toBe(2);
  });
  it('falls back to the known total length when a part has no measured duration', () => {
    const r = stitchParts([{ transcript: t([[0, 1, 2, 'a']], { durationSeconds: null }), offsetSeconds: 0 }], 4321, false);
    expect(r.durationSeconds).toBe(4321);
  });
  it('language comes from the part with the most words', () => {
    const r = stitchParts([{ transcript: t([[0, 0, 1, 'a']], { detectedLanguage: 'nn' }), offsetSeconds: 0 }, { transcript: t([[0, 0, 1, 'a'], [0, 1, 2, 'b']], { detectedLanguage: 'de' }), offsetSeconds: 10 }], null, false);
    expect(r.detectedLanguage).toBe('de');
  });
});
