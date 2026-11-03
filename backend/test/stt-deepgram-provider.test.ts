// Golden tests for the Deepgram SttProvider on recorded provider JSON (behaviour moved out of processingService unchanged).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const alerts = { failure: vi.fn(), http: vi.fn() };
vi.mock('../src/lib/alerts.js', () => ({
  reportAlert: vi.fn(),
  reportProviderFailure: (...a: any[]) => alerts.failure(...a),
  reportProviderHttpFailure: (...a: any[]) => alerts.http(...a),
}));
vi.mock('../src/config/index.js', () => ({ config: { DEEPGRAM_API_KEY: 'dg-test' } }));

const { deepgramProvider } = await import('../src/services/stt/deepgramProvider.js');

const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/stt/${n}`, import.meta.url), 'utf8'));
const calls: { url: string; init: any }[] = [];
function stubFetch(impl: (url: string, init: any) => any) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return impl(url, init); }));
}
beforeEach(() => { calls.length = 0; alerts.failure.mockReset(); alerts.http.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('deepgramProvider', () => {
  it('identifies itself', () => {
    expect(deepgramProvider.name).toBe('deepgram');
    expect(deepgramProvider.model).toBe('nova-2');
  });

  it('maps a 2-speaker Spanish response (golden)', async () => {
    stubFetch(() => ({ ok: true, json: async () => fixture('deepgram-es-two-speakers.json'), text: async () => '' }));
    const r = await deepgramProvider.transcribe(new Blob(['x']), 'u/r.m4a');
    expect({ ...r, segments: r.segments.map((s) => ({ ...s, id: 'ID' })) }).toEqual({
      segments: [
        { id: 'ID', speaker_label: 'Speaker 0', speaker_index: 0, text: 'Hola a todos, gracias por venir. Vamos a revisar los objetivos del trimestre.', start_time: 0.08, end_time: 5.2, confidence: 0.97 },
        { id: 'ID', speaker_label: 'Speaker 1', speaker_index: 1, text: 'Perfecto, yo empiezo con las ventas.', start_time: 6, end_time: 10.4, confidence: 0.95 },
        { id: 'ID', speaker_label: 'Speaker 1', speaker_index: 1, text: 'Las cifras subieron un diez por ciento.', start_time: 11.1, end_time: 21.8, confidence: 0.9 },
      ],
      fullText: 'Hola a todos, gracias por venir. Vamos a revisar los objetivos del trimestre. Perfecto, yo empiezo con las ventas. Las cifras subieron un diez por ciento.',
      wordCount: 26,
      speakerCount: 2,
      detectedLanguage: 'es',
      durationSeconds: 21.84,
    });
    expect(new Set(r.segments.map((s) => s.id)).size).toBe(3); // unique uuids
  });

  it('empty response: no segments, 1 speaker, language en, duration from metadata', async () => {
    stubFetch(() => ({ ok: true, json: async () => fixture('deepgram-empty.json'), text: async () => '' }));
    const r = await deepgramProvider.transcribe(new Blob(['x']), 'u/r.m4a');
    expect(r).toEqual({ segments: [], fullText: '', wordCount: 0, speakerCount: 1, detectedLanguage: 'en', durationSeconds: 3.2 });
  });

  it('missing / invalid metadata.duration gives null', async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ metadata: { duration: 'x' }, results: {} }), text: async () => '' }));
    expect((await deepgramProvider.transcribe(new Blob(['x']), 'a.wav')).durationSeconds).toBeNull();
  });

  it.each([['a.wav', 'audio/wav'], ['a.mp3', 'audio/mpeg'], ['a.m4a', 'audio/mp4'], ['a.webm', 'audio/mp4'], ['noext', 'audio/mp4']])(
    'content type for %s is %s',
    async (file, ct) => {
      stubFetch(() => ({ ok: true, json: async () => ({}), text: async () => '' }));
      await deepgramProvider.transcribe(new Blob(['x']), file);
      expect(calls[0].init.headers['Content-Type']).toBe(ct);
    }
  );

  it('HTTP error: throws "Deepgram API error: <status> - <body>" and reports the status', async () => {
    stubFetch(() => ({ ok: false, status: 402, text: async () => 'no credit', json: async () => ({}) }));
    await expect(deepgramProvider.transcribe(new Blob(['x']), 'a.m4a')).rejects.toThrow('Deepgram API error: 402 - no credit');
    expect(alerts.http).toHaveBeenCalledWith('deepgram', 402);
  });

  it('network error: reports and rethrows the same error', async () => {
    const boom = new Error('fetch failed');
    stubFetch(() => { throw boom; });
    await expect(deepgramProvider.transcribe(new Blob(['x']), 'a.m4a')).rejects.toBe(boom);
    expect(alerts.failure).toHaveBeenCalledWith('deepgram', boom);
  });
});
