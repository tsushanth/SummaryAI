// Characterization (golden) test: what processRecordingAsync stores for a recorded Deepgram response.
// Written BEFORE the STT provider extraction and must pass unchanged after it (default STT_PROVIDER = deepgram).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const inserts: { table: string; row: any }[] = [];
const recordingUpdates: any[] = [];
const fetchCalls: { url: string; init: any }[] = [];
let deepgramBody: any;

function builder(table: string) {
  const q: any = {};
  for (const m of ['select', 'in', 'lt', 'not', 'neq', 'order', 'limit', 'eq']) q[m] = vi.fn(() => q);
  q.update = vi.fn((p: any) => { if (table === 'recordings') recordingUpdates.push(p); return q; });
  q.insert = vi.fn((row: any) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); });
  q.single = vi.fn(() => Promise.resolve({ data: { id: 'rec-1', file_path: 'u/r.m4a', content_type: 'audio/mp4', source: 'upload', duration_seconds: 20, recording_type: 'general' }, error: null }));
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  q.then = (res: any, rej: any) => Promise.resolve({ data: null, error: null }).then(res, rej);
  return q;
}

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((t: string) => builder(t)),
    storage: { from: () => ({ download: async () => ({ data: new Blob(['audio-bytes']), error: null }) }) },
  },
}));
vi.mock('../src/config/index.js', () => ({
  config: { STORAGE_BUCKET_AUDIO: 'audio', ANTHROPIC_API_KEY: 'sk-test', DEEPGRAM_API_KEY: 'dg-test', SUMMARY_MODEL: 'm' },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ summary: 'S', key_points: ['k'], action_items: [], topics: [] }) }], stop_reason: 'end_turn' }) };
  },
}));
vi.mock('../src/lib/llm.js', () => ({ instrumentAnthropic: <T>(c: T) => c, withFeature: <T>(_n: string, fn: () => T) => fn() }));
vi.mock('../src/services/integrationsService.js', () => ({ dispatchRecordingCompleted: vi.fn() }));
vi.mock('pdf-parse', () => ({ default: async () => ({ text: 'Tiny doc.' }) }));

const { triggerProcessing, getActiveProcessingIds } = await import('../src/services/processingService.js');

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/stt/${name}`, import.meta.url), 'utf8'));
async function runJob() {
  await triggerProcessing('rec-1', 'user-1');
  await vi.waitFor(() => expect(getActiveProcessingIds().size).toBe(0));
}

beforeEach(() => {
  inserts.length = 0;
  recordingUpdates.length = 0;
  fetchCalls.length = 0;
  vi.stubEnv('STT_PROVIDER', '');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    fetchCalls.push({ url, init });
    return { ok: true, json: async () => deepgramBody, text: async () => '' };
  }));
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('default provider (deepgram): stored transcript is byte-for-byte the pre-adapter behaviour', () => {
  it('stores segments, text, counts, language and provider/model for a 2-speaker Spanish recording', async () => {
    deepgramBody = fixture('deepgram-es-two-speakers.json');
    await runJob();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&paragraphs=true&utterances=true&detect_language=true');
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(fetchCalls[0].init.headers).toEqual({ Authorization: 'Token dg-test', 'Content-Type': 'audio/mp4' });

    const t = inserts.find((i) => i.table === 'transcripts')!.row;
    expect({ ...t, id: undefined, segments: t.segments.map((s: any) => ({ ...s, id: undefined })) }).toEqual({
      id: undefined,
      recording_id: 'rec-1',
      full_text: 'Hola a todos, gracias por venir. Vamos a revisar los objetivos del trimestre. Perfecto, yo empiezo con las ventas. Las cifras subieron un diez por ciento.',
      segments: [
        { id: undefined, speaker_label: 'Speaker 0', speaker_index: 0, text: 'Hola a todos, gracias por venir. Vamos a revisar los objetivos del trimestre.', start_time: 0.08, end_time: 5.2, confidence: 0.97 },
        { id: undefined, speaker_label: 'Speaker 1', speaker_index: 1, text: 'Perfecto, yo empiezo con las ventas.', start_time: 6, end_time: 10.4, confidence: 0.95 },
        // confidence 0 from the provider falls back to 0.9 (existing `||` behaviour)
        { id: undefined, speaker_label: 'Speaker 1', speaker_index: 1, text: 'Las cifras subieron un diez por ciento.', start_time: 11.1, end_time: 21.8, confidence: 0.9 },
      ],
      word_count: 26,
      speaker_count: 2,
      language: 'es',
      transcription_provider: 'deepgram',
      transcription_model: 'nova-2',
    });
    expect(typeof t.segments[0].id).toBe('string');
    const done = recordingUpdates.find((u) => u.status === 'completed');
    expect(done).toMatchObject({ speaker_count: 2, word_count: 26, language: 'es' });
  });

  it('an empty provider response stores an empty transcript with 1 speaker and ends NO_SPEECH', async () => {
    deepgramBody = fixture('deepgram-empty.json');
    await runJob();
    const t = inserts.find((i) => i.table === 'transcripts')!.row;
    expect(t).toMatchObject({ full_text: '', segments: [], word_count: 0, speaker_count: 1, language: 'en', transcription_provider: 'deepgram' });
    expect(recordingUpdates.find((u) => u.status === 'completed')).toMatchObject({ error_code: 'NO_SPEECH' });
  });
});
