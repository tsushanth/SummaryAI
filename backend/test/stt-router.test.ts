// Provider selection (STT_PROVIDER), Soniox -> Deepgram fallback, and shadow mode.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const alert = vi.fn();
vi.mock('../src/lib/alerts.js', async (orig) => ({ ...(await orig<any>()), reportAlert: (...a: any[]) => alert(...a), reportProviderFailure: vi.fn(), reportProviderHttpFailure: vi.fn() }));
const cfg: any = { DEEPGRAM_API_KEY: 'dg-test' };
vi.mock('../src/config/index.js', () => ({ config: cfg }));
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: () => { throw new Error('supabase must not be used in these tests'); } } }));

const stt = await import('../src/services/stt/index.js');

const mkT = (over: any = {}) => ({
  segments: [{ id: 'i', speaker_label: 'Speaker 0', speaker_index: 0, text: 'SECRET words here', start_time: 0, end_time: 3, confidence: 0.9 }],
  fullText: 'the quick brown fox jumps over the lazy dog SECRET',
  wordCount: 10, speakerCount: 1, detectedLanguage: 'en', durationSeconds: 30, ...over,
});
const dgT = mkT();
const sxT = mkT({ fullText: 'the quick brown fox jumps over the lazy cat SECRET', durationSeconds: 29.5, detectedLanguage: 'es', speakerCount: 2 });
const provider = (name: string, model: string, fn: any) => ({ name, model, transcribe: vi.fn(fn) });

let dg: any, sx: any, rows: any[], store: any, env: Record<string, string | undefined>;
const deps = () => ({ deepgram: dg, soniox: sx, shadowStore: store, env: env as any, random: () => 0.5 });
const blob = new Blob(['a']);

beforeEach(() => {
  alert.mockReset();
  cfg.DEEPGRAM_API_KEY = 'dg-test';
  dg = provider('deepgram', 'nova-2', async () => dgT);
  sx = provider('soniox', 'stt-async-v6', async () => sxT);
  rows = [];
  store = { count: vi.fn(async () => rows.length), insert: vi.fn(async (r: any) => { rows.push(r); }) };
  env = { SONIOX_API_KEY: 'sx-test' };
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('getSttMode', () => {
  it.each([[undefined, 'deepgram'], ['', 'deepgram'], ['deepgram', 'deepgram'], ['soniox', 'soniox'], ['SHADOW', 'shadow'], [' soniox ', 'soniox'], ['whisper', 'deepgram']])(
    'STT_PROVIDER=%j -> %s (unknown values never change production behaviour)',
    (v, mode) => { expect(stt.getSttMode({ STT_PROVIDER: v } as any)).toBe(mode); }
  );
});

describe('isSttConfigured', () => {
  it('deepgram / shadow need the Deepgram key', () => {
    expect(stt.isSttConfigured({} as any)).toBe(true);
    cfg.DEEPGRAM_API_KEY = undefined;
    expect(stt.isSttConfigured({} as any)).toBe(false);
    expect(stt.isSttConfigured({ STT_PROVIDER: 'shadow', SONIOX_API_KEY: 'x' } as any)).toBe(false);
  });
  it('soniox needs the Soniox key, or the Deepgram key when fallback is on', () => {
    expect(stt.isSttConfigured({ STT_PROVIDER: 'soniox', SONIOX_API_KEY: 'x' } as any)).toBe(true);
    expect(stt.isSttConfigured({ STT_PROVIDER: 'soniox' } as any)).toBe(true); // falls back to Deepgram
    expect(stt.isSttConfigured({ STT_PROVIDER: 'soniox', STT_FALLBACK_TO_DEEPGRAM: 'false' } as any)).toBe(false);
    cfg.DEEPGRAM_API_KEY = undefined;
    expect(stt.isSttConfigured({ STT_PROVIDER: 'soniox' } as any)).toBe(false);
  });
});

describe('default (deepgram)', () => {
  it('only Deepgram is called, whatever the Soniox key', async () => {
    const r = await stt.transcribeAudio(blob, 'u/a.m4a', {}, deps());
    expect(r).toEqual({ transcript: dgT, provider: 'deepgram', model: 'nova-2' });
    expect(sx.transcribe).not.toHaveBeenCalled();
    await stt.flushShadowRuns();
    expect(store.insert).not.toHaveBeenCalled();
  });
  it('a Deepgram failure propagates unchanged (no fallback to Soniox)', async () => {
    const boom = new Error('Deepgram API error: 500 - x');
    dg.transcribe.mockRejectedValue(boom);
    await expect(stt.transcribeAudio(blob, 'a.m4a', {}, deps())).rejects.toBe(boom);
    expect(sx.transcribe).not.toHaveBeenCalled();
  });
  it('forwards options to the provider', async () => {
    await stt.transcribeAudio(blob, 'a.m4a', { terms: ['x'] }, deps());
    expect(dg.transcribe).toHaveBeenCalledWith(blob, 'a.m4a', { terms: ['x'] });
  });
});

describe('STT_PROVIDER=soniox', () => {
  beforeEach(() => { env.STT_PROVIDER = 'soniox'; });

  it('uses Soniox; records its provider and model; Deepgram untouched', async () => {
    const r = await stt.transcribeAudio(blob, 'a.m4a', {}, deps());
    expect(r).toEqual({ transcript: sxT, provider: 'soniox', model: 'stt-async-v6' });
    expect(dg.transcribe).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });
  it('Soniox error -> Deepgram result + a provider_fallback alert (no text in the alert)', async () => {
    sx.transcribe.mockRejectedValue(new Error('Soniox API error: 503'));
    const r = await stt.transcribeAudio(blob, 'a.m4a', {}, deps());
    expect(r).toEqual({ transcript: dgT, provider: 'deepgram', model: 'nova-2' });
    expect(alert).toHaveBeenCalledWith('provider_fallback', 'SONIOX_TO_DEEPGRAM', expect.objectContaining({ reason: 'error' }));
  });
  it('Soniox empty result (no words and no segments) -> fallback with reason empty', async () => {
    sx.transcribe.mockResolvedValue(mkT({ fullText: '', wordCount: 0, segments: [] }));
    const r = await stt.transcribeAudio(blob, 'a.m4a', {}, deps());
    expect(r.provider).toBe('deepgram');
    expect(alert).toHaveBeenCalledWith('provider_fallback', 'SONIOX_TO_DEEPGRAM', expect.objectContaining({ reason: 'empty' }));
  });
  it('both empty (truly silent audio): returns the Deepgram empty transcript, no throw', async () => {
    const empty = mkT({ fullText: '', wordCount: 0, segments: [] });
    sx.transcribe.mockResolvedValue(empty);
    dg.transcribe.mockResolvedValue(empty);
    expect((await stt.transcribeAudio(blob, 'a.m4a', {}, deps())).transcript).toBe(empty);
  });
  it('no Soniox key -> fallback with reason no_key', async () => {
    delete env.SONIOX_API_KEY;
    const r = await stt.transcribeAudio(blob, 'a.m4a', {}, deps());
    expect(r.provider).toBe('deepgram');
    expect(sx.transcribe).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('provider_fallback', 'SONIOX_TO_DEEPGRAM', expect.objectContaining({ reason: 'no_key' }));
  });
  it('STT_FALLBACK_TO_DEEPGRAM=false: the Soniox error propagates and Deepgram is never called', async () => {
    env.STT_FALLBACK_TO_DEEPGRAM = 'false';
    const boom = new Error('Soniox API error: 503');
    sx.transcribe.mockRejectedValue(boom);
    await expect(stt.transcribeAudio(blob, 'a.m4a', {}, deps())).rejects.toBe(boom);
    expect(dg.transcribe).not.toHaveBeenCalled();
  });
  it('fallback is on by default, but without a Deepgram key the Soniox error propagates', async () => {
    cfg.DEEPGRAM_API_KEY = undefined;
    const boom = new Error('Soniox down');
    sx.transcribe.mockRejectedValue(boom);
    await expect(stt.transcribeAudio(blob, 'a.m4a', {}, deps())).rejects.toBe(boom);
  });
  it('when the fallback also fails, the Deepgram error is what the caller sees', async () => {
    sx.transcribe.mockRejectedValue(new Error('soniox'));
    dg.transcribe.mockRejectedValue(new Error('deepgram too'));
    await expect(stt.transcribeAudio(blob, 'a.m4a', {}, deps())).rejects.toThrow('deepgram too');
  });
});

describe('STT_PROVIDER=shadow', () => {
  beforeEach(() => { env.STT_PROVIDER = 'shadow'; env.STT_SHADOW_USER_IDS = 'user-1'; });

  it('returns the Deepgram result and writes one metrics-only comparison row', async () => {
    const r = await stt.transcribeAudio(blob, 'u/a.m4a', { recordingId: 'rec-1', userId: 'user-1' }, deps());
    expect(r).toEqual({ transcript: dgT, provider: 'deepgram', model: 'nova-2' });
    await stt.flushShadowRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recording_id: 'rec-1',
      primary_provider: 'deepgram', primary_model: 'nova-2', shadow_provider: 'soniox', shadow_model: 'stt-async-v6',
      status: 'ok', error_class: null,
      primary_word_count: 10, shadow_word_count: 10,
      primary_duration_seconds: 30, shadow_duration_seconds: 29.5,
      primary_language: 'en', shadow_language: 'es',
      primary_speaker_count: 1, shadow_speaker_count: 2,
    });
    expect(rows[0].wer_vs_primary).toBeCloseTo(0.1, 5); // dog -> cat in 10 words
    expect(typeof rows[0].primary_latency_ms).toBe('number');
    expect(typeof rows[0].shadow_latency_ms).toBe('number');
  });
  it('the row and the log line carry no transcript text', async () => {
    await stt.transcribeAudio(blob, 'u/a.m4a', { recordingId: 'rec-1', userId: 'user-1' }, deps());
    await stt.flushShadowRuns();
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|quick|brown|u\/a\.m4a/);
    const logged = (console.log as any).mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(logged).toMatch(/\[STT shadow\]/);
    expect(logged).not.toMatch(/SECRET|quick|brown/);
  });
  it('row keys are a closed whitelist of counts/metrics', async () => {
    await stt.transcribeAudio(blob, 'a.m4a', { recordingId: 'rec-1', userId: 'user-1' }, deps());
    await stt.flushShadowRuns();
    expect(Object.keys(rows[0]).sort()).toEqual([
      'error_class', 'primary_duration_seconds', 'primary_language', 'primary_latency_ms', 'primary_model', 'primary_provider',
      'primary_speaker_count', 'primary_word_count', 'recording_id', 'shadow_duration_seconds', 'shadow_language',
      'shadow_latency_ms', 'shadow_model', 'shadow_provider', 'shadow_speaker_count', 'shadow_word_count', 'status', 'wer_vs_primary',
    ]);
  });
  it('Soniox runs concurrently with Deepgram (started before the primary finishes)', async () => {
    let release!: () => void;
    dg.transcribe.mockImplementation(() => new Promise((res) => { release = () => res(dgT); }));
    const p = stt.transcribeAudio(blob, 'a.m4a', { userId: 'user-1' }, deps());
    await vi.waitFor(() => expect(sx.transcribe).toHaveBeenCalled());
    release();
    await p;
    await stt.flushShadowRuns();
  });
  it('a Soniox failure never affects the user path; row status shadow_error with the error class', async () => {
    sx.transcribe.mockRejectedValue(Object.assign(new Error('Soniox API error: 429'), { status: 429 }));
    const r = await stt.transcribeAudio(blob, 'a.m4a', { recordingId: 'rec-1', userId: 'user-1' }, deps());
    expect(r.provider).toBe('deepgram');
    await stt.flushShadowRuns();
    expect(rows[0]).toMatchObject({ status: 'shadow_error', error_class: 'RATE_LIMIT', shadow_word_count: null, wer_vs_primary: null, primary_word_count: 10 });
  });
  it('a Soniox call that never returns is cut at STT_SHADOW_TIMEOUT_MS (row shadow_timeout) and does not delay the user', async () => {
    env.STT_SHADOW_TIMEOUT_MS = '30';
    sx.transcribe.mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    await stt.transcribeAudio(blob, 'a.m4a', { recordingId: 'rec-1', userId: 'user-1' }, deps());
    expect(Date.now() - t0).toBeLessThan(25);
    await stt.flushShadowRuns();
    expect(rows[0]).toMatchObject({ status: 'shadow_timeout', error_class: 'TIMEOUT' });
    expect(sx.transcribe.mock.calls[0][2]).toMatchObject({ timeoutMs: 30 });
  });
  it('an empty Soniox result is recorded as shadow_empty with no WER', async () => {
    sx.transcribe.mockResolvedValue(mkT({ fullText: '', wordCount: 0, segments: [] }));
    await stt.transcribeAudio(blob, 'a.m4a', { recordingId: 'r', userId: 'user-1' }, deps());
    await stt.flushShadowRuns();
    expect(rows[0]).toMatchObject({ status: 'shadow_empty', shadow_word_count: 0, wer_vs_primary: null });
  });
  it('a failing row insert is logged, never thrown', async () => {
    store.insert.mockRejectedValue(new Error('relation "stt_shadow_runs" does not exist'));
    await expect(stt.transcribeAudio(blob, 'a.m4a', { userId: 'user-1' }, deps())).resolves.toMatchObject({ provider: 'deepgram' });
    await expect(stt.flushShadowRuns()).resolves.toBeUndefined();
  });
  it('without a Soniox key nothing is sent anywhere', async () => {
    delete env.SONIOX_API_KEY;
    await stt.transcribeAudio(blob, 'a.m4a', { userId: 'user-1' }, deps());
    await stt.flushShadowRuns();
    expect(sx.transcribe).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
  it('if the primary (Deepgram) fails, the error propagates and no row is written', async () => {
    dg.transcribe.mockRejectedValue(new Error('Deepgram API error: 500'));
    await expect(stt.transcribeAudio(blob, 'a.m4a', { userId: 'user-1' }, deps())).rejects.toThrow('Deepgram API error');
    await stt.flushShadowRuns();
    expect(rows).toHaveLength(0);
  });
  it('STT_SHADOW_SAMPLE_RATE: 0 sends no audio; 1 sends all; rate is compared with random()', async () => {
    env.STT_SHADOW_SAMPLE_RATE = '0';
    await stt.transcribeAudio(blob, 'a.m4a', { userId: 'user-1' }, deps());
    expect(sx.transcribe).not.toHaveBeenCalled();
    env.STT_SHADOW_SAMPLE_RATE = '0.4'; // random() = 0.5 -> skipped
    await stt.transcribeAudio(blob, 'a.m4a', { userId: 'user-1' }, deps());
    expect(sx.transcribe).not.toHaveBeenCalled();
    env.STT_SHADOW_SAMPLE_RATE = '0.6'; // sampled
    await stt.transcribeAudio(blob, 'a.m4a', { userId: 'user-1' }, deps());
    await stt.flushShadowRuns();
    expect(sx.transcribe).toHaveBeenCalledTimes(1);
  });
  it('STT_SHADOW_MAX_RUNS caps the number of shadowed recordings using the table count', async () => {
    env.STT_SHADOW_MAX_RUNS = '2';
    for (let i = 0; i < 4; i++) { await stt.transcribeAudio(blob, 'a.m4a', { recordingId: `r${i}`, userId: 'user-1' }, deps()); await stt.flushShadowRuns(); }
    expect(rows).toHaveLength(2);
    expect(sx.transcribe).toHaveBeenCalledTimes(2);
  });
  it('if the table cannot be read (migration not applied) while a cap is set, no audio is sent', async () => {
    env.STT_SHADOW_MAX_RUNS = '5';
    store.count.mockRejectedValue(new Error('relation does not exist'));
    await stt.transcribeAudio(blob, 'a.m4a', { userId: 'user-1' }, deps());
    await stt.flushShadowRuns();
    expect(sx.transcribe).not.toHaveBeenCalled();
  });
});
