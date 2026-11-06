// Shadow mode: per-user allow-list (fails closed), candidate selection, language gate. Primary readaloud mode: language gate,
// declined inputs, fallback. Default path unchanged with every new variable present.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const alert = vi.fn();
vi.mock('../src/lib/alerts.js', async (orig) => ({ ...(await orig<any>()), reportAlert: (...a: any[]) => alert(...a), reportProviderFailure: vi.fn(), reportProviderHttpFailure: vi.fn() }));
const cfg: any = { DEEPGRAM_API_KEY: 'dg-test' };
vi.mock('../src/config/index.js', () => ({ config: cfg }));
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: () => { throw new Error('supabase must not be used in these tests'); } } }));

const stt = await import('../src/services/stt/index.js');
const { deepgramProvider } = await import('../src/services/stt/deepgramProvider.js');
const gate = await import('../src/services/stt/languageGate.js');

const mkT = (over: any = {}) => ({
  segments: [{ id: 'i', speaker_label: 'Speaker 0', speaker_index: 0, text: 'SECRET words here', start_time: 0, end_time: 3, confidence: 0.9 }],
  fullText: 'the quick brown fox jumps over the lazy dog SECRET',
  wordCount: 10, speakerCount: 1, detectedLanguage: 'en', durationSeconds: 30, ...over,
});
const dgT = mkT();
const raT = mkT({ fullText: 'the quick brown fox jumps over the lazy cat SECRET', durationSeconds: 29.5 });
const sxT = mkT({ fullText: 'the quick brown fox jumps over the lazy bat SECRET', durationSeconds: 29.4 });
const provider = (name: string, model: string, fn: any, precheck?: any) => ({ name, model, transcribe: vi.fn(fn), ...(precheck ? { precheck: vi.fn(precheck) } : {}) });

let dg: any, ra: any, sx: any, rows: any[], store: any, env: Record<string, string | undefined>;
const deps = () => ({ deepgram: dg, soniox: sx, readaloud: ra, shadowStore: store, env: env as any, random: () => 0.5 });
const blob = new Blob(['a']);
const run = (opts: any = {}) => stt.transcribeAudio(blob, 'u/a.m4a', { recordingId: 'rec-1', ...opts }, deps());

beforeEach(() => {
  alert.mockReset();
  cfg.DEEPGRAM_API_KEY = 'dg-test';
  dg = provider('deepgram', 'nova-2', async () => dgT);
  ra = provider('readaloud', 'whisper-large-v3-turbo', async () => raT);
  sx = provider('soniox', 'stt-async-v6', async () => sxT);
  rows = [];
  store = { count: vi.fn(async () => rows.length), insert: vi.fn(async (r: any) => { rows.push(r); }) };
  env = { STT_PROVIDER: 'shadow', SONIOX_API_KEY: 'sx-test', READALOUD_STT_URL: 'https://w.example', READALOUD_STT_TOKEN: 'tok', STT_SHADOW_USER_IDS: 'user-1' };
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const nothingSent = async () => {
  await stt.flushShadowRuns();
  expect(sx.transcribe).not.toHaveBeenCalled();
  expect(ra.transcribe).not.toHaveBeenCalled();
  expect(store.count).not.toHaveBeenCalled();
  expect(rows).toHaveLength(0);
};

describe('shadow user allow-list (fails closed)', () => {
  it.each([[undefined], [''], ['   '], [' , ,'], ['*'], ['all'], ['true']])('STT_SHADOW_USER_IDS=%j: nobody is shadowed, for either candidate', async (v) => {
    env.STT_SHADOW_USER_IDS = v;
    for (const cand of [undefined, 'soniox', 'readaloud']) {
      env.STT_SHADOW_CANDIDATE = cand;
      const r = await run({ userId: 'user-1' });
      expect(r).toEqual({ transcript: dgT, provider: 'deepgram', model: 'nova-2' });
      await nothingSent();
    }
  });
  it('a user who is not on the list is not shadowed', async () => {
    env.STT_SHADOW_USER_IDS = 'user-2,user-3';
    await run({ userId: 'user-1' });
    await nothingSent();
  });
  it('a call with no user id is not shadowed, even when the list is set', async () => {
    await run({});
    await nothingSent();
    await run({ userId: '' });
    await nothingSent();
  });
  it('a listed user is shadowed; ids are trimmed and compared case-insensitively; partial ids do not match', async () => {
    env.STT_SHADOW_USER_IDS = ' u-9 , USER-1 ';
    await run({ userId: 'user-1' });
    await stt.flushShadowRuns();
    expect(sx.transcribe).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    sx.transcribe.mockClear();
    await run({ userId: 'user' });
    await run({ userId: 'user-10' });
    await stt.flushShadowRuns();
    expect(sx.transcribe).not.toHaveBeenCalled();
  });
  it('the helpers agree', () => {
    expect([...stt.getShadowUserIds({ STT_SHADOW_USER_IDS: ' A, b ,,' } as any)]).toEqual(['a', 'b']);
    expect(stt.isShadowUser('A', { STT_SHADOW_USER_IDS: 'a' } as any)).toBe(true);
    expect(stt.isShadowUser(undefined, { STT_SHADOW_USER_IDS: 'a' } as any)).toBe(false);
    expect(stt.isShadowUser('a', {} as any)).toBe(false);
  });
  it('the allow-list does not affect non-shadow modes', async () => {
    env.STT_PROVIDER = 'deepgram';
    env.STT_SHADOW_USER_IDS = undefined;
    expect((await run({ userId: 'user-1' })).provider).toBe('deepgram');
    await nothingSent();
  });
});

describe('shadow candidate selection', () => {
  it.each([[undefined], [''], ['soniox'], [' SONIOX ']])('STT_SHADOW_CANDIDATE=%j runs Soniox (today\'s behaviour)', async (v) => {
    env.STT_SHADOW_CANDIDATE = v;
    const r = await run({ userId: 'user-1' });
    await stt.flushShadowRuns();
    expect(r).toEqual({ transcript: dgT, provider: 'deepgram', model: 'nova-2' });
    expect(sx.transcribe).toHaveBeenCalledTimes(1);
    expect(ra.transcribe).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ shadow_provider: 'soniox', shadow_model: 'stt-async-v6', status: 'ok' });
  });
  it('the Soniox call itself is unchanged: the caller options plus the timeout, nothing from the readaloud path', async () => {
    await run({ userId: 'user-1', terms: ['x'], languageHints: ['fr'], durationHintSeconds: 99 });
    await stt.flushShadowRuns();
    expect(sx.transcribe.mock.calls[0][2]).toEqual({ terms: ['x'], languageHints: ['fr'], timeoutMs: 900000 });
    expect(dg.transcribe.mock.calls[0][2]).toEqual({ terms: ['x'], languageHints: ['fr'] }); // userId / duration hint never reach Deepgram
  });
  it('readaloud: the worker is called (not Soniox); row names it; the user transcript is still Deepgram\'s, untouched', async () => {
    env.STT_SHADOW_CANDIDATE = 'readaloud';
    delete env.SONIOX_API_KEY;
    const r = await run({ userId: 'user-1', durationHintSeconds: 1200 });
    await stt.flushShadowRuns();
    expect(r.transcript).toBe(dgT);
    expect(r.provider).toBe('deepgram');
    expect(sx.transcribe).not.toHaveBeenCalled();
    expect(ra.transcribe).toHaveBeenCalledTimes(1);
    expect(ra.transcribe.mock.calls[0][2]).toMatchObject({ allowChunkLocalSpeakers: true, durationHintSeconds: 1200, timeoutMs: 900000 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ primary_provider: 'deepgram', shadow_provider: 'readaloud', shadow_model: 'whisper-large-v3-turbo', status: 'ok', primary_word_count: 10, shadow_word_count: 10 });
    expect(rows[0].wer_vs_primary).toBeCloseTo(0.1, 5);
  });
  it('readaloud rows hold counts and metrics only', async () => {
    env.STT_SHADOW_CANDIDATE = 'readaloud';
    await run({ userId: 'user-1' });
    await stt.flushShadowRuns();
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|quick|brown|u\/a\.m4a|user-1/);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'error_class', 'primary_duration_seconds', 'primary_language', 'primary_latency_ms', 'primary_model', 'primary_provider',
      'primary_speaker_count', 'primary_word_count', 'recording_id', 'shadow_duration_seconds', 'shadow_language',
      'shadow_latency_ms', 'shadow_model', 'shadow_provider', 'shadow_speaker_count', 'shadow_word_count', 'status', 'wer_vs_primary',
    ]);
  });
  it('readaloud without READALOUD_STT_URL / TOKEN: nothing is sent', async () => {
    env.STT_SHADOW_CANDIDATE = 'readaloud';
    delete env.READALOUD_STT_TOKEN;
    await run({ userId: 'user-1' });
    await nothingSent();
  });
  it('soniox without its key: nothing is sent, even if readaloud is configured', async () => {
    delete env.SONIOX_API_KEY;
    await run({ userId: 'user-1' });
    await nothingSent();
  });
  it('an unknown candidate turns shadow off (no audio goes to a guessed vendor) and warns once per value', async () => {
    env.STT_SHADOW_CANDIDATE = 'whisperx-typo';
    await run({ userId: 'user-1' });
    await run({ userId: 'user-1' });
    await nothingSent();
    expect((console.warn as any).mock.calls.filter((c: any[]) => String(c[0]).includes('unknown STT_SHADOW_CANDIDATE'))).toHaveLength(1);
    expect(stt.getShadowCandidateName({ STT_SHADOW_CANDIDATE: 'readaloud' } as any)).toBe('readaloud');
    expect(stt.getShadowCandidateName({} as any)).toBe('soniox');
  });
  it('a readaloud failure never touches the user path; row is shadow_error with the class', async () => {
    env.STT_SHADOW_CANDIDATE = 'readaloud';
    ra.transcribe.mockRejectedValue(Object.assign(new Error('ReadAloud STT error: 413 - too long'), { status: 413 }));
    const r = await run({ userId: 'user-1' });
    expect(r.transcript).toBe(dgT);
    await stt.flushShadowRuns();
    expect(rows[0]).toMatchObject({ status: 'shadow_error', shadow_word_count: null, wer_vs_primary: null, primary_word_count: 10 });
    expect(alert).not.toHaveBeenCalled();
  });
  it('a readaloud call that never returns is cut at the shadow timeout', async () => {
    env.STT_SHADOW_CANDIDATE = 'readaloud';
    env.STT_SHADOW_TIMEOUT_MS = '30';
    ra.transcribe.mockImplementation(() => new Promise(() => {}));
    await run({ userId: 'user-1' });
    await stt.flushShadowRuns();
    expect(rows[0]).toMatchObject({ status: 'shadow_timeout', error_class: 'TIMEOUT' });
  });
  it('a candidate that declines the input (precheck) gets no audio and no row', async () => {
    env.STT_SHADOW_CANDIDATE = 'readaloud';
    ra = provider('readaloud', 'whisper-large-v3-turbo', async () => raT, async () => 'long_recording_format_not_splittable');
    await run({ userId: 'user-1', durationHintSeconds: 9000 });
    await stt.flushShadowRuns();
    expect(ra.precheck).toHaveBeenCalled();
    expect(ra.transcribe).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
  it('the primary failing still propagates and writes no row', async () => {
    env.STT_SHADOW_CANDIDATE = 'readaloud';
    dg.transcribe.mockRejectedValue(new Error('Deepgram API error: 500'));
    await expect(run({ userId: 'user-1' })).rejects.toThrow('Deepgram API error');
    await stt.flushShadowRuns();
    expect(rows).toHaveLength(0);
  });
});

describe('language gate, shadow readaloud', () => {
  beforeEach(() => { env.STT_SHADOW_CANDIDATE = 'readaloud'; });

  it.each([['hi'], ['id'], ['uk'], ['vi'], ['ko'], ['it'], ['HI'], ['hi-IN']])('hint %s is outside the trusted set: nothing is sent to the worker and no row is written', async (hint) => {
    await run({ userId: 'user-1', languageHints: [hint] });
    await nothingSent();
  });
  it.each([['en'], ['es'], ['fr'], ['de'], ['pt'], ['ru'], ['ja'], ['zh'], ['fr-CA']])('hint %s is trusted: the worker runs and gets the hint', async (hint) => {
    await run({ userId: 'user-1', languageHints: [hint] });
    await stt.flushShadowRuns();
    expect(ra.transcribe).toHaveBeenCalledTimes(1);
    expect(ra.transcribe.mock.calls[0][2].languageHints).toEqual([hint]);
    expect(rows[0].status).toBe('ok');
  });
  it('hint auto or blank means auto-detect (runs, and the detected language is then checked)', async () => {
    await run({ userId: 'user-1', languageHints: ['auto'] });
    await run({ userId: 'user-1', languageHints: [''] });
    await stt.flushShadowRuns();
    expect(ra.transcribe).toHaveBeenCalledTimes(2);
  });
  it('an unrecognised hint is not guessed at: skipped', async () => {
    await run({ userId: 'user-1', languageHints: ['klingon'] });
    await nothingSent();
  });
  it.each([['hi'], ['id'], ['uk'], ['vi'], ['ko']])('no hint and detected %s: the worker transcript is discarded, recorded as an error with a distinct class and the language only', async (lang) => {
    ra.transcribe.mockResolvedValue(mkT({ detectedLanguage: lang }));
    const r = await run({ userId: 'user-1' });
    expect(r.transcript).toBe(dgT);
    await stt.flushShadowRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'shadow_error', error_class: 'LANGUAGE_UNSUPPORTED', shadow_language: lang, shadow_word_count: null, shadow_speaker_count: null, shadow_duration_seconds: null, wer_vs_primary: null });
    const logged = (console.log as any).mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(logged).toMatch(/discarded/);
    expect(logged).not.toMatch(/SECRET|quick/);
  });
  it('no hint and detected en/es: kept', async () => {
    for (const lang of ['en', 'es']) {
      rows.length = 0;
      ra.transcribe.mockResolvedValue(mkT({ detectedLanguage: lang }));
      await run({ userId: 'user-1' });
      await stt.flushShadowRuns();
      expect(rows[0]).toMatchObject({ status: 'ok', shadow_language: lang });
    }
  });
  it('a trusted pinned hint is not second-guessed by the detected language', async () => {
    ra.transcribe.mockResolvedValue(mkT({ detectedLanguage: 'hi' }));
    await run({ userId: 'user-1', languageHints: ['es'] });
    await stt.flushShadowRuns();
    expect(rows[0].status).toBe('ok');
  });
  it('the Soniox candidate is not language gated', async () => {
    env.STT_SHADOW_CANDIDATE = 'soniox';
    sx.transcribe.mockResolvedValue(mkT({ detectedLanguage: 'hi' }));
    await run({ userId: 'user-1', languageHints: ['hi'] });
    await stt.flushShadowRuns();
    expect(sx.transcribe).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: 'ok', shadow_language: 'hi' });
  });
});

describe('language gate helpers', () => {
  it('trusted set is exactly en es fr de pt ru ja zh', () => {
    expect([...gate.READALOUD_TRUSTED_LANGUAGES].sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh']);
  });
  it('hint and detected checks', () => {
    expect(gate.languageHintSkipReason(undefined)).toBeNull();
    expect(gate.languageHintSkipReason([])).toBeNull();
    expect(gate.languageHintSkipReason(['de'])).toBeNull();
    expect(gate.languageHintSkipReason(['hi'])).toBe('language_hint_unsupported');
    expect(gate.languageHintSkipReason(['zz'])).toBe('language_hint_unrecognised');
    expect(gate.detectedLanguageRejectReason('zh-CN')).toBeNull();
    expect(gate.detectedLanguageRejectReason('hi')).toBe('language_unsupported');
    expect(gate.detectedLanguageRejectReason(undefined)).toBe('language_unsupported');
    expect(gate.hasLanguageHint(['auto'])).toBe(false);
    expect(gate.hasLanguageHint(['hi'])).toBe(true);
  });
});

describe('STT_PROVIDER=readaloud: language gate, declined inputs, fallback', () => {
  beforeEach(() => { env.STT_PROVIDER = 'readaloud'; });

  it('trusted language, no hint: the worker result is used', async () => {
    const r = await run({ userId: 'user-1' });
    expect(r).toEqual({ transcript: raT, provider: 'readaloud', model: 'whisper-large-v3-turbo' });
    expect(dg.transcribe).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });
  it('userId is never forwarded to a provider; the duration hint only goes to the worker', async () => {
    await run({ userId: 'user-1', durationHintSeconds: 700 });
    expect(ra.transcribe.mock.calls[0][2]).toEqual({ durationHintSeconds: 700 });
    env.STT_PROVIDER = 'deepgram';
    await run({ userId: 'user-1', durationHintSeconds: 700 });
    expect(dg.transcribe.mock.calls[0][2]).toEqual({});
  });
  it.each([['hi'], ['id'], ['uk'], ['vi']])('hint %s: Deepgram is used, the worker is never contacted, no alert (it is routing, not a failure)', async (hint) => {
    const r = await run({ languageHints: [hint] });
    expect(r.provider).toBe('deepgram');
    expect(ra.transcribe).not.toHaveBeenCalled();
    expect(dg.transcribe).toHaveBeenCalledWith(blob, 'u/a.m4a', { languageHints: [hint] });
    expect(alert).not.toHaveBeenCalled();
  });
  it('no hint, detected Hindi: the worker transcript is discarded and Deepgram\'s is used', async () => {
    ra.transcribe.mockResolvedValue(mkT({ detectedLanguage: 'hi', fullText: 'garbled' }));
    const r = await run({});
    expect(r).toEqual({ transcript: dgT, provider: 'deepgram', model: 'nova-2' });
    expect(ra.transcribe).toHaveBeenCalledTimes(1);
    expect(dg.transcribe).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });
  it('if Deepgram then fails, that error is what the caller sees and Deepgram is called once (not retried as a worker failure)', async () => {
    ra.transcribe.mockResolvedValue(mkT({ detectedLanguage: 'hi' }));
    dg.transcribe.mockRejectedValue(new Error('Deepgram API error: 500'));
    await expect(run({})).rejects.toThrow('Deepgram API error');
    expect(dg.transcribe).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });
  it('trusted pinned hint: result kept whatever language the worker reports', async () => {
    ra.transcribe.mockResolvedValue(mkT({ detectedLanguage: 'hi' }));
    expect((await run({ languageHints: ['es'] })).provider).toBe('readaloud');
  });
  it('without a usable Deepgram the worker is still used (a lower-trust transcript beats a failed recording)', async () => {
    cfg.DEEPGRAM_API_KEY = undefined;
    expect((await run({ languageHints: ['hi'] })).provider).toBe('readaloud');
    ra.transcribe.mockResolvedValue(mkT({ detectedLanguage: 'hi' }));
    expect((await run({})).provider).toBe('readaloud');
    cfg.DEEPGRAM_API_KEY = 'dg-test';
    env.STT_FALLBACK_TO_DEEPGRAM = 'false';
    expect((await run({})).provider).toBe('readaloud');
    expect(dg.transcribe).not.toHaveBeenCalled();
  });
  it('input the worker declines (too long to split): Deepgram, worker never sent audio, no alert', async () => {
    ra = provider('readaloud', 'whisper-large-v3-turbo', async () => raT, async () => 'long_recording_format_not_splittable');
    const r = await run({ durationHintSeconds: 7000 });
    expect(r.provider).toBe('deepgram');
    expect(ra.transcribe).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });
  it.each([
    ['HTTP 413', Object.assign(new Error('ReadAloud STT error: 413 - audio too long'), { status: 413 })],
    ['a timeout', Object.assign(new Error('ReadAloud STT timed out after 960000ms'), { name: 'TimeoutError' })],
    ['a connection error', new Error('fetch failed')],
    ['unmatchable speakers across parts', new Error('ReadAloud STT: multi-speaker audio was split into parts and speakers cannot be matched across parts')],
  ])('%s falls back to Deepgram with READALOUD_TO_DEEPGRAM and the recording does not fail', async (_n, err) => {
    ra.transcribe.mockRejectedValue(err);
    const r = await run({});
    expect(r).toEqual({ transcript: dgT, provider: 'deepgram', model: 'nova-2' });
    expect(alert).toHaveBeenCalledWith('provider_fallback', 'READALOUD_TO_DEEPGRAM', expect.objectContaining({ reason: 'error' }));
  });
  it('an empty worker result falls back with reason empty', async () => {
    ra.transcribe.mockResolvedValue(mkT({ fullText: '', wordCount: 0, segments: [] }));
    expect((await run({})).provider).toBe('deepgram');
    expect(alert).toHaveBeenCalledWith('provider_fallback', 'READALOUD_TO_DEEPGRAM', expect.objectContaining({ reason: 'empty' }));
  });
});

describe('default path is unchanged when the new variables are set but STT_PROVIDER is not', () => {
  const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/stt/${n}`, import.meta.url), 'utf8'));
  const calls: { url: string; init: any }[] = [];
  afterEach(() => vi.unstubAllGlobals());

  it.each([[{}], [{ STT_PROVIDER: 'deepgram' }], [{ STT_PROVIDER: '' }]])('env %j + shadow variables + candidate keys: one Deepgram request, identical to calling the provider directly', async (extra) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => fixture('deepgram-es-two-speakers.json'), text: async () => '' }; }));
    const direct = await deepgramProvider.transcribe(blob, 'u/r.m4a', { languageHints: ['es'] });
    const directCall = calls.splice(0);
    const viaSeam = await stt.transcribeAudio(
      blob, 'u/r.m4a',
      { recordingId: 'r', userId: 'user-1', durationHintSeconds: 600, languageHints: ['es'] },
      { env: { ...extra, STT_SHADOW_CANDIDATE: 'readaloud', STT_SHADOW_USER_IDS: 'user-1', SONIOX_API_KEY: 'sx', READALOUD_STT_URL: 'https://w.example', READALOUD_STT_TOKEN: 't' } as any }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(directCall[0]!.url);
    expect(calls[0]!.init).toEqual(directCall[0]!.init);
    expect(viaSeam.provider).toBe('deepgram');
    const norm = (r: any) => ({ ...r, segments: r.segments.map((s: any) => ({ ...s, id: 'ID' })) });
    expect(norm(viaSeam.transcript)).toEqual(norm(direct));
    await stt.flushShadowRuns();
    expect(calls).toHaveLength(1);
  });
});
