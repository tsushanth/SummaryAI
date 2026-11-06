// The final-transcript selector (STT_PROVIDER): default path is Deepgram only and byte-identical on the wire;
// unknown values warn and fall back; the readaloud candidate is opt-in and falls back to Deepgram.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const alert = vi.fn();
vi.mock('../src/lib/alerts.js', async (orig) => ({ ...(await orig<any>()), reportAlert: (...a: any[]) => alert(...a), reportProviderFailure: vi.fn(), reportProviderHttpFailure: vi.fn() }));
const cfg: any = { DEEPGRAM_API_KEY: 'dg-test' };
vi.mock('../src/config/index.js', () => ({ config: cfg }));
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: () => { throw new Error('supabase must not be used in these tests'); } } }));

const stt = await import('../src/services/stt/index.js');
const { deepgramProvider } = await import('../src/services/stt/deepgramProvider.js');

const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/stt/${n}`, import.meta.url), 'utf8'));
const blob = new Blob(['audio']);
const norm = (r: any) => ({ ...r, segments: r.segments.map((s: any) => ({ ...s, id: 'ID' })) });

const calls: { url: string; init: any }[] = [];
function stubFetch(impl: (url: string, init: any) => any) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return impl(url, init); }));
}
const dgBody = () => fixture('deepgram-es-two-speakers.json');
const dgOk = () => ({ ok: true, status: 200, json: async () => dgBody(), text: async () => '' });

beforeEach(() => {
  calls.length = 0; alert.mockReset(); cfg.DEEPGRAM_API_KEY = 'dg-test';
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('default path equals calling Deepgram directly', () => {
  const candidateEnv = { READALOUD_STT_URL: 'https://worker.example', READALOUD_STT_TOKEN: 't', SONIOX_API_KEY: 'sx' };

  it.each([[{}], [{ STT_PROVIDER: 'deepgram' }], [{ STT_PROVIDER: 'whisper-typo' }], [{ STT_PROVIDER: '' }]])(
    'env %j: the same single HTTP request and the same result as the Deepgram provider, even with candidate keys present',
    async (extra) => {
      stubFetch(dgOk);
      const direct = await deepgramProvider.transcribe(blob, 'u/r.m4a', { languageHints: ['es'] });
      const directCall = calls.splice(0);

      const viaSeam = await stt.transcribeAudio(blob, 'u/r.m4a', { recordingId: 'r', languageHints: ['es'] }, { env: { ...candidateEnv, ...extra } as any });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(directCall[0].url);
      expect(calls[0].url).toMatch(/^https:\/\/api\.deepgram\.com\/v1\/listen\?model=nova-2&/);
      expect(calls[0].init).toEqual(directCall[0].init);
      expect(norm(viaSeam.transcript)).toEqual(norm(direct));
      expect(viaSeam.provider).toBe('deepgram');
      expect(viaSeam.model).toBe('nova-2');
      expect(alert).not.toHaveBeenCalled();
    }
  );

  it('a Deepgram HTTP failure propagates unchanged and nothing else is called', async () => {
    stubFetch(() => ({ ok: false, status: 402, text: async () => 'no credit', json: async () => ({}) }));
    await expect(stt.transcribeAudio(blob, 'a.m4a', {}, { env: candidateEnv as any })).rejects.toThrow('Deepgram API error: 402 - no credit');
    expect(calls).toHaveLength(1);
  });
});

describe('getSttMode', () => {
  it.each([['readaloud', 'readaloud'], [' ReadAloud ', 'readaloud'], ['soniox', 'soniox'], ['shadow', 'shadow'], ['deepgram', 'deepgram'], [undefined, 'deepgram']])(
    'STT_PROVIDER=%j -> %s', (v, mode) => { expect(stt.getSttMode({ STT_PROVIDER: v } as any)).toBe(mode); });

  it('an unknown value falls back to deepgram and warns once per distinct value', () => {
    expect(stt.getSttMode({ STT_PROVIDER: 'assembly' } as any)).toBe('deepgram');
    expect(stt.getSttMode({ STT_PROVIDER: 'assembly' } as any)).toBe('deepgram');
    const warns = (console.warn as any).mock.calls.filter((c: any[]) => String(c[0]).includes('unknown STT_PROVIDER'));
    expect(warns).toHaveLength(1);
    expect(warns[0][0]).toContain('"assembly"');
    stt.getSttMode({ STT_PROVIDER: 'other' } as any);
    expect((console.warn as any).mock.calls.filter((c: any[]) => String(c[0]).includes('unknown STT_PROVIDER'))).toHaveLength(2);
  });

  it('known values and unset never warn', () => {
    for (const v of [undefined, '', 'deepgram', 'soniox', 'shadow', 'readaloud']) stt.getSttMode({ STT_PROVIDER: v } as any);
    expect((console.warn as any).mock.calls.filter((c: any[]) => String(c[0]).includes('unknown STT_PROVIDER'))).toHaveLength(0);
  });
});

describe('STT_PROVIDER=readaloud', () => {
  const env = { STT_PROVIDER: 'readaloud', READALOUD_STT_URL: 'https://worker.example', READALOUD_STT_TOKEN: 'tok' };
  const mkT = (over: any = {}) => ({
    segments: [{ id: 'i', speaker_label: 'Speaker 0', speaker_index: 0, text: 'hi there', start_time: 0, end_time: 1, confidence: 0.9 }],
    fullText: 'hi there', wordCount: 2, speakerCount: 1, detectedLanguage: 'en', durationSeconds: 1, ...over,
  });
  const prov = (name: string, model: string, fn: any) => ({ name, model, transcribe: vi.fn(fn) });
  let dg: any, ra: any;
  const deps = (e: any = env) => ({ deepgram: dg, readaloud: ra, env: e });
  beforeEach(() => { dg = prov('deepgram', 'nova-2', async () => mkT({ fullText: 'from deepgram' })); ra = prov('readaloud', 'whisper-large-v3-turbo', async () => mkT()); });

  it('uses the worker and records its provider and model; Deepgram untouched', async () => {
    const r = await stt.transcribeAudio(blob, 'a.m4a', {}, deps());
    expect(r).toEqual({ transcript: mkT(), provider: 'readaloud', model: 'whisper-large-v3-turbo' });
    expect(dg.transcribe).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });
  it('worker error -> Deepgram result + READALOUD_TO_DEEPGRAM alert', async () => {
    ra.transcribe.mockRejectedValue(new Error('ReadAloud STT error: 503'));
    const r = await stt.transcribeAudio(blob, 'a.m4a', {}, deps());
    expect(r.provider).toBe('deepgram');
    expect(alert).toHaveBeenCalledWith('provider_fallback', 'READALOUD_TO_DEEPGRAM', expect.objectContaining({ reason: 'error' }));
  });
  it('empty worker result -> fallback with reason empty', async () => {
    ra.transcribe.mockResolvedValue(mkT({ fullText: '', wordCount: 0, segments: [] }));
    expect((await stt.transcribeAudio(blob, 'a.m4a', {}, deps())).provider).toBe('deepgram');
    expect(alert).toHaveBeenCalledWith('provider_fallback', 'READALOUD_TO_DEEPGRAM', expect.objectContaining({ reason: 'empty' }));
  });
  it('URL or token missing -> worker never called, Deepgram used (reason no_key)', async () => {
    const r = await stt.transcribeAudio(blob, 'a.m4a', {}, deps({ STT_PROVIDER: 'readaloud', READALOUD_STT_URL: 'https://worker.example' }));
    expect(r.provider).toBe('deepgram');
    expect(ra.transcribe).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('provider_fallback', 'READALOUD_TO_DEEPGRAM', expect.objectContaining({ reason: 'no_key' }));
  });
  it('STT_FALLBACK_TO_DEEPGRAM=false: the worker error propagates', async () => {
    const boom = new Error('worker down');
    ra.transcribe.mockRejectedValue(boom);
    await expect(stt.transcribeAudio(blob, 'a.m4a', {}, deps({ ...env, STT_FALLBACK_TO_DEEPGRAM: 'false' }))).rejects.toBe(boom);
    expect(dg.transcribe).not.toHaveBeenCalled();
  });
  it('isSttConfigured: configured worker, or Deepgram key as fallback', () => {
    expect(stt.isSttConfigured(env as any)).toBe(true);
    expect(stt.isSttConfigured({ STT_PROVIDER: 'readaloud' } as any)).toBe(true);
    expect(stt.isSttConfigured({ STT_PROVIDER: 'readaloud', STT_FALLBACK_TO_DEEPGRAM: 'false' } as any)).toBe(false);
    cfg.DEEPGRAM_API_KEY = undefined;
    expect(stt.isSttConfigured({ STT_PROVIDER: 'readaloud' } as any)).toBe(false);
    expect(stt.isSttConfigured(env as any)).toBe(true);
  });
});
