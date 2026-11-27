// Which language a stored summary is asked for in, through the real processing job: chosen, else spoken, else (documents) the text's.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const inserts: { table: string; row: any }[] = [];
const recordingUpdates: any[] = [];
const fetchCalls: { url: string; init: any }[] = [];
let deepgramBody: any;
let recordingExtra: Record<string, unknown> = {};
const llm: { system: string; messages: { content: string }[] }[] = [];

function builder(table: string) {
  const q: any = {};
  for (const m of ['select', 'in', 'lt', 'not', 'neq', 'order', 'limit', 'eq']) q[m] = vi.fn(() => q);
  q.update = vi.fn((p: any) => { if (table === 'recordings') recordingUpdates.push(p); return q; });
  q.insert = vi.fn((row: any) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); });
  q.single = vi.fn(() => Promise.resolve({ data: { id: 'rec-1', file_path: 'u/r.m4a', content_type: 'audio/mp4', source: 'upload', duration_seconds: 20, recording_type: 'general', ...recordingExtra }, error: null }));
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
    messages = { create: async (p: any) => (llm.push(p), { content: [{ type: 'text', text: JSON.stringify({ summary: 'S', key_points: ['k'], action_items: [], topics: [] }) }], stop_reason: 'end_turn' }) };
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
  llm.length = 0;
  recordingExtra = {};
  vi.stubEnv('STT_PROVIDER', '');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    fetchCalls.push({ url, init });
    return { ok: true, json: async () => deepgramBody, text: async () => '' };
  }));
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** The Spanish fixture made long enough (words and seconds) that the recording is summarised rather than skipped as too short. */
function longSpanishRecording() {
  const body = fixture('deepgram-es-two-speakers.json');
  const alt = body.results.channels[0].alternatives[0];
  alt.transcript = Array(6).fill(alt.transcript).join(' ');
  body.metadata = { ...body.metadata, duration: 180 };
  recordingExtra = { duration_seconds: 180, ...recordingExtra };
  return body;
}

describe('summary language of a processed recording', () => {
  const prompt = () => llm[0].messages[0].content;

  it('no chosen language: the summary is asked for in the language that was spoken', async () => {
    deepgramBody = longSpanishRecording();
    await runJob();
    expect(prompt()).toContain('topics in Spanish.');
    expect(llm[0].system).toContain('in Spanish');
  });

  it('a chosen language wins over the spoken one', async () => {
    recordingExtra = { output_language: 'de' };
    deepgramBody = longSpanishRecording();
    await runJob();
    expect(prompt()).toContain('topics in German.');
    expect(prompt()).not.toContain('Spanish');
  });

  it('a document has no detected language: the model is asked to follow its text', async () => {
    recordingExtra = { file_path: 'u/doc.pdf', content_type: 'application/pdf', duration_seconds: null };
    await runJob();
    expect(prompt()).toContain('main language of the transcript');
    expect(prompt()).not.toContain('topics in English.');
  });
});
