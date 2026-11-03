// Soniox async adapter. Fixtures are written from the documented response shape (docs.soniox.com, verified 2026-11-03);
// no live calls. Endpoints: POST /v1/files, POST /v1/transcriptions, GET /v1/transcriptions/{id},
// GET /v1/transcriptions/{id}/transcript, DELETE /v1/transcriptions/{id}, DELETE /v1/files/{id}.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const alerts = { failure: vi.fn(), http: vi.fn() };
vi.mock('../src/lib/alerts.js', () => ({
  reportAlert: vi.fn(),
  reportProviderFailure: (...a: any[]) => alerts.failure(...a),
  reportProviderHttpFailure: (...a: any[]) => alerts.http(...a),
}));
vi.mock('../src/config/index.js', () => ({ config: {} }));

const { createSonioxProvider, mapSonioxTokens, SONIOX_ASYNC_MODEL } = await import('../src/services/stt/sonioxProvider.js');

const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/stt/${n}`, import.meta.url), 'utf8'));
const TID = '3f1b6c9e-0000-4000-8000-000000000001';
const FID = '9a7d1c20-0000-4000-8000-000000000002';
const BASE = 'https://api.soniox.com/v1';

interface Call { method: string; url: string; init: any }
let calls: Call[];
let statuses: string[];
let overrides: Record<string, () => any>;

const json = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
function stubSoniox() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, init });
    const key = `${method} ${url.replace(BASE, '')}`;
    for (const [k, fn] of Object.entries(overrides)) if (key === k) return fn();
    if (key === 'POST /files') return json({ id: FID, filename: 'recording.m4a', size: 1, created_at: 'x' }, 201);
    if (key === 'POST /transcriptions') return json({ id: TID, status: 'queued', model: SONIOX_ASYNC_MODEL }, 201);
    if (key === `GET /transcriptions/${TID}`) {
      const s = statuses.shift() ?? 'completed';
      return json({ ...fixture('soniox-transcription-completed.json'), status: s, audio_duration_ms: s === 'queued' ? undefined : 21840 });
    }
    if (key === `GET /transcriptions/${TID}/transcript`) return json(fixture('soniox-transcript-es-two-speakers.json'));
    if (key === `DELETE /transcriptions/${TID}` || key === `DELETE /files/${FID}`) return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
    throw new Error(`unexpected ${key}`);
  }));
}
const mk = () => createSonioxProvider({ apiKey: 'sx-test', pollIntervalMs: 0 });
const blob = () => new Blob(['audio']);

beforeEach(() => { calls = []; statuses = ['queued', 'processing', 'completed']; overrides = {}; alerts.failure.mockReset(); alerts.http.mockReset(); stubSoniox(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('sonioxProvider.transcribe: request flow', () => {
  it('identifies itself with the verified async model id', () => {
    expect(mk().name).toBe('soniox');
    expect(mk().model).toBe('stt-async-v6');
  });

  it('uploads, creates with diarization + language identification, polls until completed, fetches, then deletes both', async () => {
    await mk().transcribe(blob(), 'user-123/secret-name.m4a');
    expect(calls.map((c) => `${c.method} ${c.url.replace(BASE, '')}`)).toEqual([
      'POST /files',
      'POST /transcriptions',
      `GET /transcriptions/${TID}`,
      `GET /transcriptions/${TID}`,
      `GET /transcriptions/${TID}`,
      `GET /transcriptions/${TID}/transcript`,
      `DELETE /transcriptions/${TID}`,
      `DELETE /files/${FID}`,
    ]);
    for (const c of calls) expect(c.init.headers.Authorization).toBe('Bearer sx-test');

    const form = calls[0].init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const file = form.get('file') as File;
    expect(file.name).toBe('recording.m4a'); // never the user's storage path / file name
    expect(JSON.stringify([...form.keys()])).not.toContain('user-123');

    const create = JSON.parse(calls[1].init.body);
    expect(create).toEqual({
      model: 'stt-async-v6',
      file_id: FID,
      enable_speaker_diarization: true,
      enable_language_identification: true,
    });
    expect(calls[1].init.headers['Content-Type']).toBe('application/json');
    expect('language_hints' in create).toBe(false); // auto-detect, like Deepgram detect_language
  });

  it('passes vocabulary terms and language hints only when given', async () => {
    await mk().transcribe(blob(), 'a.wav', { terms: ['Kreative Koala', 'MeetingMind'], languageHints: ['es', 'en'] });
    expect(JSON.parse(calls[1].init.body)).toMatchObject({
      context: { terms: ['Kreative Koala', 'MeetingMind'] },
      language_hints: ['es', 'en'],
    });
  });

  it('error status: throws with the provider error_type and still deletes server-side data', async () => {
    overrides[`GET /transcriptions/${TID}`] = () => json({ ...fixture('soniox-transcription-completed.json'), status: 'error', error_type: 'audio_invalid', error_message: 'bad audio' });
    await expect(mk().transcribe(blob(), 'a.m4a')).rejects.toThrow(/Soniox transcription failed: audio_invalid/);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/transcriptions/${TID}`))).toBe(true);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/files/${FID}`))).toBe(true);
  });

  it('HTTP failure on upload: throws, reports the status, nothing to delete', async () => {
    overrides['POST /files'] = () => json({ error: 'nope' }, 401);
    await expect(mk().transcribe(blob(), 'a.m4a')).rejects.toThrow(/Soniox API error: 401/);
    expect(alerts.http).toHaveBeenCalledWith('soniox', 401);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('HTTP failure after upload still deletes the uploaded file', async () => {
    overrides['POST /transcriptions'] = () => json({}, 429);
    await expect(mk().transcribe(blob(), 'a.m4a')).rejects.toThrow(/429/);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/files/${FID}`))).toBe(true);
  });

  it('a failing cleanup never fails the transcription', async () => {
    overrides[`DELETE /transcriptions/${TID}`] = () => { throw new Error('boom'); };
    overrides[`DELETE /files/${FID}`] = () => json({}, 500);
    const r = await mk().transcribe(blob(), 'a.m4a');
    expect(r.wordCount).toBe(26);
  });

  it('network error: reports and rethrows', async () => {
    overrides['POST /files'] = () => { throw new Error('fetch failed'); };
    await expect(mk().transcribe(blob(), 'a.m4a')).rejects.toThrow('fetch failed');
    expect(alerts.failure).toHaveBeenCalled();
  });

  it('times out when the job never completes, and cleans up', async () => {
    statuses = Array(10_000).fill('processing');
    const p = createSonioxProvider({ apiKey: 'sx-test', pollIntervalMs: 5 });
    await expect(p.transcribe(blob(), 'a.m4a', { timeoutMs: 40 })).rejects.toThrow(/timed out/i);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/transcriptions/${TID}`))).toBe(true);
  });

  it('refuses without an API key (env SONIOX_API_KEY is the only source) and makes no call', async () => {
    vi.stubEnv('SONIOX_API_KEY', '');
    const p = createSonioxProvider({ pollIntervalMs: 0 });
    await expect(p.transcribe(blob(), 'a.m4a')).rejects.toThrow('SONIOX_API_KEY is not set');
    expect(calls).toHaveLength(0);
    vi.stubEnv('SONIOX_API_KEY', 'from-env');
    await createSonioxProvider({ pollIntervalMs: 0 }).transcribe(blob(), 'a.m4a');
    expect(calls[0].init.headers.Authorization).toBe('Bearer from-env');
  });
});

describe('sonioxProvider.transcribe: NormalizedTranscript mapping (golden, 2-speaker Spanish)', () => {
  it('maps tokens to speaker-turn segments, language, duration and word count', async () => {
    const r = await mk().transcribe(blob(), 'a.m4a');
    expect(r.segments).toHaveLength(3);
    expect(r.segments.map((s) => ({ ...s, id: undefined, confidence: undefined }))).toEqual([
      { id: undefined, speaker_label: 'Speaker 0', speaker_index: 0, text: 'Hola a todos, gracias por venir. Vamos a revisar los objetivos del trimestre.', start_time: 0.08, end_time: 5.2, confidence: undefined },
      { id: undefined, speaker_label: 'Speaker 1', speaker_index: 1, text: 'Perfecto, yo empiezo con las ventas.', start_time: 6, end_time: 10.4, confidence: undefined },
      // 2.7 s of silence inside one speaker's turn starts a new segment (like Deepgram utterances)
      { id: undefined, speaker_label: 'Speaker 1', speaker_index: 1, text: 'Las cifras subieron un diez por ciento.', start_time: 13.1, end_time: 21.8, confidence: undefined },
    ]);
    for (const s of r.segments) { expect(s.confidence).toBeGreaterThan(0.9); expect(s.confidence).toBeLessThanOrEqual(1); expect(typeof s.id).toBe('string'); }
    expect(r.fullText).toBe('Hola a todos, gracias por venir. Vamos a revisar los objetivos del trimestre. Perfecto, yo empiezo con las ventas. Las cifras subieron un diez por ciento.');
    expect(r.wordCount).toBe(26);
    expect(r.speakerCount).toBe(2);
    expect(r.detectedLanguage).toBe('es');
    expect(r.durationSeconds).toBe(21.84);
  });
});

describe('mapSonioxTokens', () => {
  const tok = (text: string, start_ms: number, end_ms: number, extra: any = {}) => ({ text, start_ms, end_ms, confidence: 0.9, ...extra });

  it('empty tokens: empty transcript, 1 speaker, en, duration from the job', () => {
    expect(mapSonioxTokens([], 3200)).toEqual({ segments: [], fullText: '', wordCount: 0, speakerCount: 1, detectedLanguage: 'en', durationSeconds: 3.2 });
  });
  it('no speaker field (diarization absent): one speaker, index 0', () => {
    const r = mapSonioxTokens([tok('Hi', 0, 200), tok(' there', 250, 600)], null);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ speaker_label: 'Speaker 0', speaker_index: 0, text: 'Hi there' });
    expect(r.speakerCount).toBe(1);
  });
  it('speakers are 1-based strings and map to 0-based indexes, matching Deepgram (speaker_names keys stay stable)', () => {
    const r = mapSonioxTokens([tok('A', 0, 100, { speaker: '1' }), tok('B', 120, 200, { speaker: '3' }), tok('C', 220, 300, { speaker: '1' })], null);
    expect(r.segments.map((s) => s.speaker_index)).toEqual([0, 2, 0]);
    expect(r.segments.map((s) => s.speaker_label)).toEqual(['Speaker 0', 'Speaker 2', 'Speaker 0']);
    expect(r.speakerCount).toBe(2);
  });
  it('a non-numeric speaker id falls back to index 0 rather than NaN', () => {
    const r = mapSonioxTokens([tok('A', 0, 100, { speaker: 'x' })], null);
    expect(r.segments[0].speaker_index).toBe(0);
  });
  it('duration: job audio_duration_ms wins; else last token end; else null', () => {
    expect(mapSonioxTokens([tok('A', 0, 4000)], 9000).durationSeconds).toBe(9);
    expect(mapSonioxTokens([tok('A', 0, 4000)], null).durationSeconds).toBe(4);
    expect(mapSonioxTokens([], null).durationSeconds).toBeNull();
    expect(mapSonioxTokens([], 0).durationSeconds).toBeNull();
  });
  it('language: majority by characters, region stripped, lowercased; mixed-language meeting', () => {
    const r = mapSonioxTokens([
      tok('Bonjour tout le monde', 0, 500, { language: 'fr' }),
      tok(' ok', 600, 700, { language: 'en' }),
      tok(' merci beaucoup', 800, 1200, { language: 'FR-ca' }),
    ], null);
    expect(r.detectedLanguage).toBe('fr');
  });
  it('splits on silence gaps of 1.5 s or more, not on shorter pauses', () => {
    const r = mapSonioxTokens([tok('One', 0, 500), tok(' two', 1900, 2300), tok(' three', 3900, 4300)], null);
    expect(r.segments.map((s) => s.text)).toEqual(['One two', 'three']);
  });
  it('splits an unbroken monologue at a sentence end once a segment passes 45 s', () => {
    const toks: any[] = [];
    for (let i = 0; i < 100; i++) toks.push(tok(i % 10 === 9 ? ' w.' : ' w', i * 1000, i * 1000 + 900));
    const r = mapSonioxTokens(toks, null);
    expect(r.segments.length).toBeGreaterThan(1);
    expect(r.segments.every((s) => s.end_time - s.start_time <= 60)).toBe(true);
    expect(r.segments.slice(0, -1).every((s) => s.text.endsWith('.'))).toBe(true);
  });
  it('ignores tokens with empty text and tolerates missing timestamps/confidence', () => {
    const r = mapSonioxTokens([{ text: '' } as any, { text: 'Hello' } as any], null);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ text: 'Hello', start_time: 0, end_time: 0, confidence: 0.9 });
  });
  it('unspaced scripts: wordCount uses whitespace split like Deepgram (the short-recording guard has its own CJK rule)', () => {
    const r = mapSonioxTokens([tok('你好世界', 0, 800, { language: 'zh' })], null);
    expect(r.wordCount).toBe(1);
    expect(r.detectedLanguage).toBe('zh');
  });
});
