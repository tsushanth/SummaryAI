// Self-hosted Whisper adapter: request shape (mocked HTTP client), response mapping, error behaviour.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const alerts = { failure: vi.fn(), http: vi.fn() };
vi.mock('../src/lib/alerts.js', () => ({
  reportAlert: vi.fn(),
  reportProviderFailure: (...a: any[]) => alerts.failure(...a),
  reportProviderHttpFailure: (...a: any[]) => alerts.http(...a),
}));

const { createReadaloudProvider, mapReadaloudResponse, isReadaloudConfigured, READALOUD_MODEL } = await import('../src/services/stt/readaloudProvider.js');

const twoSpeakers = () => ({
  metadata: { duration: 21.84 },
  results: {
    channels: [{ detected_language: 'es', alternatives: [{ transcript: 'Hola a todos. Perfecto, yo empiezo. Subieron las cifras.' }] }],
    utterances: [
      { id: 'u0', start: 0.08, end: 5.2, speaker: 0, transcript: 'Hola a todos.', confidence: 0.97 },
      { id: 'u1', start: 6, end: 10.4, speaker: 1, transcript: 'Perfecto, yo empiezo.', confidence: 0.95 },
      { id: 'u2', start: 11.1, end: 21.8, speaker: 1, transcript: 'Subieron las cifras.' },
    ],
  },
});

const calls: { url: string; init: any }[] = [];
function stubFetch(impl: (url: string, init: any) => any) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return impl(url, init); }));
}
const ok = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
const mk = () => createReadaloudProvider({ baseUrl: 'https://worker.example/', token: 'tok-test' });

beforeEach(() => { calls.length = 0; alerts.failure.mockReset(); alerts.http.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('readaloud provider', () => {
  it('identifies itself', () => {
    expect(mk().name).toBe('readaloud');
    expect(mk().model).toBe(READALOUD_MODEL);
  });

  it('maps a 2-speaker response to the NormalizedTranscript shape', async () => {
    stubFetch(() => ok(twoSpeakers()));
    const r = await mk().transcribe(new Blob(['x']), 'u/r.m4a');
    expect({ ...r, segments: r.segments.map((s) => ({ ...s, id: 'ID' })) }).toEqual({
      segments: [
        { id: 'ID', speaker_label: 'Speaker 0', speaker_index: 0, text: 'Hola a todos.', start_time: 0.08, end_time: 5.2, confidence: 0.97 },
        { id: 'ID', speaker_label: 'Speaker 1', speaker_index: 1, text: 'Perfecto, yo empiezo.', start_time: 6, end_time: 10.4, confidence: 0.95 },
        { id: 'ID', speaker_label: 'Speaker 1', speaker_index: 1, text: 'Subieron las cifras.', start_time: 11.1, end_time: 21.8, confidence: 0.9 },
      ],
      fullText: 'Hola a todos. Perfecto, yo empiezo. Subieron las cifras.',
      wordCount: 9,
      speakerCount: 2,
      detectedLanguage: 'es',
      durationSeconds: 21.84,
    });
    expect(new Set(r.segments.map((s) => s.id)).size).toBe(3);
  });

  it('sends raw audio with bearer auth to /v1/listen, diarize on, language detection by default', async () => {
    stubFetch(() => ok(twoSpeakers()));
    const blob = new Blob(['audio-bytes']);
    await mk().transcribe(blob, 'u/r.wav');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://worker.example/v1/listen?diarize=true&utterances=true&smart_format=true&detect_language=true');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer tok-test', 'Content-Type': 'audio/wav' });
    expect(calls[0].init.body).toBe(blob);
  });

  it('pins a supported language hint; retries once with detection when the worker answers 400', async () => {
    let n = 0;
    stubFetch(() => (n++ === 0 ? { ok: false, status: 400, text: async () => 'bad language', json: async () => ({}) } : ok(twoSpeakers())));
    await mk().transcribe(new Blob(['x']), 'a.m4a', { languageHints: ['es'] });
    expect(calls.map((c) => c.url.split('&').pop())).toEqual(['language=es', 'detect_language=true']);
  });

  it('forwards vocabulary terms as keyterm parameters', async () => {
    stubFetch(() => ok(twoSpeakers()));
    await mk().transcribe(new Blob(['x']), 'a.m4a', { terms: ['Acme Corp', 'q4'] });
    expect(calls[0].url).toMatch(/&keyterm=Acme%20Corp&keyterm=q4$/);
  });

  it('HTTP error: throws with status, reports it, never includes the token', async () => {
    stubFetch(() => ({ ok: false, status: 413, text: async () => 'diarize_too_long', json: async () => ({}) }));
    const e: any = await mk().transcribe(new Blob(['x']), 'a.m4a').catch((x) => x);
    expect(e.message).toBe('ReadAloud STT error: 413 - diarize_too_long');
    expect(e.status).toBe(413);
    expect(alerts.http).toHaveBeenCalledWith('readaloud', 413);
    expect(e.message).not.toContain('tok-test');
  });

  it('network error: reports and rethrows the same error', async () => {
    const boom = new Error('fetch failed');
    stubFetch(() => { throw boom; });
    await expect(mk().transcribe(new Blob(['x']), 'a.m4a')).rejects.toBe(boom);
    expect(alerts.failure).toHaveBeenCalledWith('readaloud', boom);
  });

  it('timeout aborts the request and surfaces a TimeoutError', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: any) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const e: any = await mk().transcribe(new Blob(['x']), 'a.m4a', { timeoutMs: 20 }).catch((x) => x);
    expect(e.name).toBe('TimeoutError');
    expect(alerts.failure).toHaveBeenCalledWith('readaloud', e);
  });

  it('refuses to call anything without a URL and token', async () => {
    stubFetch(() => ok({}));
    const bare = createReadaloudProvider({ baseUrl: '', token: '' });
    const saved = { u: process.env.READALOUD_STT_URL, t: process.env.READALOUD_STT_TOKEN };
    delete process.env.READALOUD_STT_URL; delete process.env.READALOUD_STT_TOKEN;
    try {
      await expect(bare.transcribe(new Blob(['x']), 'a.m4a')).rejects.toThrow('not set');
    } finally {
      if (saved.u !== undefined) process.env.READALOUD_STT_URL = saved.u;
      if (saved.t !== undefined) process.env.READALOUD_STT_TOKEN = saved.t;
    }
    expect(calls).toHaveLength(0);
  });
});

describe('mapReadaloudResponse', () => {
  it('silent audio: empty transcript, one speaker, language en, duration kept', () => {
    const r = mapReadaloudResponse({ metadata: { duration: 3.2 }, results: { channels: [{ alternatives: [{ transcript: '' }] }] } });
    expect(r).toEqual({ segments: [], fullText: '', wordCount: 0, speakerCount: 1, detectedLanguage: 'en', durationSeconds: 3.2 });
  });
  it('text without speaker turns is an error (a worker that ignored diarize must not look like one speaker)', () => {
    expect(() => mapReadaloudResponse({ results: { channels: [{ alternatives: [{ transcript: 'hello there' }] }] } })).toThrow('without speaker turns');
  });
  it('normalizes the language and treats a bad duration as null', () => {
    const r = mapReadaloudResponse({ metadata: { duration: 'x' }, results: { channels: [{ detected_language: 'PT-BR', alternatives: [{ transcript: 'oi' }] }], utterances: [{ speaker: 'a', start: 0, end: 1, transcript: 'oi' }] } });
    expect(r.detectedLanguage).toBe('pt');
    expect(r.durationSeconds).toBeNull();
    expect(r.segments[0].speaker_index).toBe(0);
  });
});

describe('isReadaloudConfigured', () => {
  it.each([
    [{}, false],
    [{ READALOUD_STT_URL: 'https://x' }, false],
    [{ READALOUD_STT_TOKEN: 't' }, false],
    [{ READALOUD_STT_URL: ' ', READALOUD_STT_TOKEN: 't' }, false],
    [{ READALOUD_STT_URL: 'https://x', READALOUD_STT_TOKEN: 't' }, true],
  ])('%j -> %s', (env, expected) => { expect(isReadaloudConfigured(env as any)).toBe(expected); });
});
