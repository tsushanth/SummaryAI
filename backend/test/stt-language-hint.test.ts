// The language chosen for a meeting reaches the final-transcript providers: Deepgram `language=` (else detect_language) and Soniox language_hints.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../src/lib/alerts.js', () => ({ reportAlert: vi.fn(), reportProviderFailure: vi.fn(), reportProviderHttpFailure: vi.fn() }));
vi.mock('../src/config/index.js', () => ({ config: { DEEPGRAM_API_KEY: 'dg-test' } }));
const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/lib/supabase.js', () => ({ get supabaseAdmin() { return h.db; } }));

const { deepgramProvider } = await import('../src/services/stt/deepgramProvider.js');
const { createSonioxProvider } = await import('../src/services/stt/sonioxProvider.js');
const { transcribeAudio } = await import('../src/services/stt/index.js');
const { languageHintForRecording } = await import('../src/services/meetingLanguage.js');
const { FakeDb } = await import('./helpers-fakeDb.js');

const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/stt/${n}`, import.meta.url), 'utf8'));
const calls: { url: string; init: any }[] = [];
const ok = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
function stubFetch(impl: (url: string, init: any) => any) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return impl(url, init); }));
}
beforeEach(() => { calls.length = 0; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const LEGACY_URL = 'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&paragraphs=true&utterances=true&detect_language=true';

describe('Deepgram language parameter', () => {
  it('no hint (and auto-detect callers): the request URL is byte-for-byte the old one', async () => {
    stubFetch(() => ok(fixture('deepgram-es-two-speakers.json')));
    await deepgramProvider.transcribe(new Blob(['x']), 'u/r.m4a');
    await deepgramProvider.transcribe(new Blob(['x']), 'u/r.m4a', { languageHints: [] });
    expect(calls.map((c) => c.url)).toEqual([LEGACY_URL, LEGACY_URL]);
  });
  it('a chosen language replaces detect_language with language=', async () => {
    stubFetch(() => ok(fixture('deepgram-es-two-speakers.json')));
    await deepgramProvider.transcribe(new Blob(['x']), 'u/r.m4a', { languageHints: ['fr'] });
    expect(calls[0]!.url).toBe(LEGACY_URL.replace('detect_language=true', 'language=fr'));
    expect(calls[0]!.url).not.toContain('detect_language');
  });
  it('keeps detect_language for languages nova-2 does not support (he, hr) and for unknown codes', async () => {
    stubFetch(() => ok(fixture('deepgram-es-two-speakers.json')));
    for (const l of ['he', 'hr', 'zz']) await deepgramProvider.transcribe(new Blob(['x']), 'u/r.m4a', { languageHints: [l] });
    expect(calls.every((c) => c.url === LEGACY_URL)).toBe(true);
  });
  it('reports the pinned language when Deepgram returns no detected_language', async () => {
    stubFetch(() => ok({ metadata: { duration: 3 }, results: { channels: [{ alternatives: [{ transcript: 'bonjour' }] }], utterances: [] } }));
    const r = await deepgramProvider.transcribe(new Blob(['x']), 'u/r.m4a', { languageHints: ['fr'] });
    expect(r.detectedLanguage).toBe('fr');
  });
  it('a 400 on the pinned language retries once with detect_language instead of failing the recording', async () => {
    let n = 0;
    stubFetch(() => (++n === 1 ? { ok: false, status: 400, json: async () => ({}), text: async () => 'bad language' } : ok(fixture('deepgram-es-two-speakers.json'))));
    const r = await deepgramProvider.transcribe(new Blob(['x']), 'u/r.m4a', { languageHints: ['fr'] });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe(LEGACY_URL);
    expect(r.detectedLanguage).toBe('es');
  });
  it('a 400 with auto-detect is NOT retried (error behaviour unchanged)', async () => {
    stubFetch(() => ({ ok: false, status: 400, json: async () => ({}), text: async () => 'bad audio' }));
    await expect(deepgramProvider.transcribe(new Blob(['x']), 'u/r.m4a')).rejects.toThrow(/Deepgram API error: 400/);
    expect(calls).toHaveLength(1);
  });
});

describe('Soniox async language_hints', () => {
  it('sends language_hints only when a language is chosen, identification stays on', async () => {
    const bodies: any[] = [];
    const TID = 't1';
    stubFetch((url: string, init: any) => {
      const key = `${init?.method || 'GET'} ${url}`;
      if (key === 'POST https://api.soniox.com/v1/files') return ok({ id: 'f1' });
      if (key === 'POST https://api.soniox.com/v1/transcriptions') { bodies.push(JSON.parse(init.body)); return ok({ id: TID }); }
      if (key === `GET https://api.soniox.com/v1/transcriptions/${TID}`) return ok({ ...fixture('soniox-transcription-completed.json'), id: TID });
      if (key === `GET https://api.soniox.com/v1/transcriptions/${TID}/transcript`) return ok(fixture('soniox-transcript-es-two-speakers.json'));
      return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
    });
    const p = createSonioxProvider({ apiKey: 'sx', pollIntervalMs: 1 } as any);
    await p.transcribe(new Blob(['x']), 'u/r.m4a');
    await p.transcribe(new Blob(['x']), 'u/r.m4a', { languageHints: ['es'] });
    expect(bodies[0]).not.toHaveProperty('language_hints');
    expect(bodies[1].language_hints).toEqual(['es']);
    expect(bodies[1].enable_language_identification).toBe(true);
  });
});

describe('transcribeAudio passes the hint to the chosen provider', () => {
  it('deepgram mode forwards languageHints', async () => {
    const dg = { name: 'deepgram', model: 'nova-2', transcribe: vi.fn(async () => ({ segments: [], fullText: 'x', wordCount: 1, speakerCount: 1, detectedLanguage: 'fr' })) };
    await transcribeAudio(new Blob(['x']), 'a.m4a', { recordingId: 'r', languageHints: ['fr'] }, { deepgram: dg as any, env: {} as any });
    expect(dg.transcribe).toHaveBeenCalledWith(expect.anything(), 'a.m4a', { languageHints: ['fr'] });
  });
  it('default call has no languageHints key at all', async () => {
    const dg = { name: 'deepgram', model: 'nova-2', transcribe: vi.fn(async () => ({ segments: [], fullText: 'x', wordCount: 1, speakerCount: 1, detectedLanguage: 'en' })) };
    await transcribeAudio(new Blob(['x']), 'a.m4a', { recordingId: 'r' }, { deepgram: dg as any, env: {} as any });
    expect(dg.transcribe).toHaveBeenCalledWith(expect.anything(), 'a.m4a', {});
  });
});

describe('languageHintForRecording', () => {
  let db: InstanceType<typeof FakeDb>;
  beforeEach(() => { db = new FakeDb(); h.db = db; });
  const M = '00000000-0000-4000-8000-0000000000aa';

  it('null for uploads (no meeting) and for auto', async () => {
    expect(await languageHintForRecording({ meeting_id: null })).toBeNull();
    expect(await languageHintForRecording({})).toBeNull();
    db.seed('meetings', { id: M, transcription_language: 'auto' });
    db.seed('bot_runs', { meeting_id: M, status: 'completed', transcription_language: null });
    expect(await languageHintForRecording({ meeting_id: M })).toBeNull();
  });
  it('uses the latest bot run, then the meeting', async () => {
    db.seed('meetings', { id: M, transcription_language: 'de' });
    expect(await languageHintForRecording({ meeting_id: M })).toBe('de');
    db.seed('bot_runs', { meeting_id: M, status: 'completed', transcription_language: 'es' });
    expect(await languageHintForRecording({ meeting_id: M })).toBe('es');
  });
  it('never throws and returns null when the columns do not exist yet', async () => {
    db.missing.add('bot_runs.transcription_language');
    db.missing.add('meetings.transcription_language');
    db.seed('meetings', { id: M });
    db.seed('bot_runs', { meeting_id: M, status: 'completed' });
    expect(await languageHintForRecording({ meeting_id: M })).toBeNull();
  });
});
