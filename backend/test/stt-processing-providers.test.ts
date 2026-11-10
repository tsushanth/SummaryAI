// End to end through processRecordingAsync with STT_PROVIDER = soniox | shadow, HTTP stubbed at fetch (no live calls).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const inserts: { table: string; row: any }[] = [];
const recordingUpdates: any[] = [];
let fileName = 'u/r.m4a';

function builder(table: string) {
  const q: any = {};
  for (const m of ['select', 'in', 'lt', 'not', 'neq', 'order', 'limit', 'eq']) q[m] = vi.fn(() => q);
  q.update = vi.fn((p: any) => { if (table === 'recordings') recordingUpdates.push(p); return q; });
  q.insert = vi.fn((row: any) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); });
  q.single = vi.fn(() => Promise.resolve({ data: { id: 'rec-1', file_path: fileName, content_type: fileName.endsWith('.pdf') ? 'application/pdf' : 'audio/mp4', source: 'upload', duration_seconds: 20, recording_type: 'general' }, error: null }));
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  q.then = (res: any, rej: any) => Promise.resolve({ data: null, error: null, count: 0 }).then(res, rej);
  return q;
}
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((t: string) => builder(t)),
    storage: { from: () => ({ download: async () => ({ data: new Blob(['audio-bytes']), error: null }) }) },
  },
}));
const cfg: any = { STORAGE_BUCKET_AUDIO: 'audio', ANTHROPIC_API_KEY: 'sk-test', DEEPGRAM_API_KEY: 'dg-test', SUMMARY_MODEL: 'm' };
vi.mock('../src/config/index.js', () => ({ config: cfg }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ summary: 'S', key_points: ['k'], action_items: [], topics: [] }) }], stop_reason: 'end_turn' }) }; },
}));
vi.mock('../src/lib/llm.js', () => ({ instrumentAnthropic: <T>(c: T) => c, withFeature: <T>(_n: string, fn: () => T) => fn() }));
vi.mock('../src/services/integrationsService.js', () => ({ dispatchRecordingCompleted: vi.fn() }));
vi.mock('pdf-parse', () => ({ default: async () => ({ text: 'Tiny doc.' }) }));
const alert = vi.fn();
vi.mock('../src/lib/alerts.js', async (orig) => ({ ...(await orig<any>()), reportAlert: (...a: any[]) => alert(...a), reportProviderFailure: vi.fn(), reportProviderHttpFailure: vi.fn() }));

const { triggerProcessing, getActiveProcessingIds } = await import('../src/services/processingService.js');
const { flushShadowRuns } = await import('../src/services/stt/index.js');

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/stt/${n}`, import.meta.url), 'utf8'));
const TID = 'tid';
let sonioxFails = false;
let urls: string[];
const res = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

async function runJob() {
  await triggerProcessing('rec-1', 'user-1');
  await vi.waitFor(() => expect(getActiveProcessingIds().size).toBe(0));
  await flushShadowRuns();
}
const transcriptRow = () => inserts.find((i) => i.table === 'transcripts')!.row;

beforeEach(() => {
  inserts.length = 0; recordingUpdates.length = 0; urls = []; alert.mockReset();
  fileName = 'u/r.m4a'; sonioxFails = false; cfg.DEEPGRAM_API_KEY = 'dg-test';
  vi.stubEnv('SONIOX_API_KEY', 'sx-test');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    urls.push(key);
    if (url.startsWith('https://api.deepgram.com')) return res(fx('deepgram-es-two-speakers.json'));
    if (sonioxFails && !key.startsWith('DELETE')) return res({}, 503);
    if (key === 'POST https://api.soniox.com/v1/files') return res({ id: 'fid' }, 201);
    if (key === 'POST https://api.soniox.com/v1/transcriptions') return res({ id: TID, status: 'queued' }, 201);
    if (key === `GET https://api.soniox.com/v1/transcriptions/${TID}`) return res({ ...fx('soniox-transcription-completed.json'), id: TID });
    if (key === `GET https://api.soniox.com/v1/transcriptions/${TID}/transcript`) return res(fx('soniox-transcript-es-two-speakers.json'));
    if (key.startsWith('DELETE')) return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
    throw new Error(`unexpected ${key}`);
  }));
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('STT_PROVIDER=soniox through the processing job', () => {
  beforeEach(() => vi.stubEnv('STT_PROVIDER', 'soniox'));

  it('stores the Soniox transcript with provider soniox / stt-async-v6 and never calls Deepgram', async () => {
    await runJob();
    const t = transcriptRow();
    expect(t).toMatchObject({ transcription_provider: 'soniox', transcription_model: 'stt-async-v6', language: 'es', speaker_count: 2, word_count: 26 });
    expect(t.segments.map((s: any) => s.speaker_label)).toEqual(['Speaker 0', 'Speaker 1', 'Speaker 1']);
    expect(urls.some((u) => u.includes('deepgram'))).toBe(false);
    // The provider-measured duration (21.84 s) and word count (26) feed shortRecordingGuard: under 30 s and under 60 words
    // is TOO_SHORT, exactly as the same fixture is for Deepgram. Guard inputs from Soniox are therefore wired.
    expect(recordingUpdates.find((u) => u.status === 'completed')).toMatchObject({ error_code: 'TOO_SHORT', word_count: 26, speaker_count: 2, language: 'es' });
    expect(inserts.some((i) => i.table === 'summaries')).toBe(false);
  });

  it('Soniox 503 falls back to Deepgram: the recording still completes, stored as deepgram, one alert', async () => {
    sonioxFails = true;
    await runJob();
    expect(transcriptRow()).toMatchObject({ transcription_provider: 'deepgram', transcription_model: 'nova-2', language: 'es' });
    expect(recordingUpdates.some((u) => u.status === 'completed')).toBe(true);
    expect(recordingUpdates.some((u) => u.status === 'failed')).toBe(false);
    expect(alert).toHaveBeenCalledWith('provider_fallback', 'SONIOX_TO_DEEPGRAM', expect.anything());
  });

  it('with no Deepgram key and Soniox failing, the job fails like any provider outage (no silent mock)', async () => {
    sonioxFails = true; cfg.DEEPGRAM_API_KEY = undefined;
    await runJob();
    expect(recordingUpdates.some((u) => u.status === 'failed')).toBe(true);
    expect(inserts.some((i) => i.table === 'transcripts')).toBe(false);
  });
});

describe('STT_PROVIDER=shadow through the processing job', () => {
  beforeEach(() => { vi.stubEnv('STT_PROVIDER', 'shadow'); vi.stubEnv('STT_SHADOW_USER_IDS', 'user-1'); });

  it('stores the Deepgram transcript and one metrics-only stt_shadow_runs row', async () => {
    await runJob();
    expect(transcriptRow()).toMatchObject({ transcription_provider: 'deepgram', transcription_model: 'nova-2' });
    const rowInserts = inserts.filter((i) => i.table === 'stt_shadow_runs');
    expect(rowInserts).toHaveLength(1);
    expect(rowInserts[0].row).toMatchObject({ recording_id: 'rec-1', status: 'ok', primary_word_count: 26, shadow_word_count: 26, primary_language: 'es', shadow_language: 'es', wer_vs_primary: 0 });
    expect(JSON.stringify(rowInserts[0].row)).not.toMatch(/Hola|cifras/);
  });

  it('Soniox down: user path identical, row recorded as shadow_error', async () => {
    sonioxFails = true;
    await runJob();
    expect(transcriptRow().transcription_provider).toBe('deepgram');
    expect(recordingUpdates.some((u) => u.status === 'failed')).toBe(false);
    expect(inserts.find((i) => i.table === 'stt_shadow_runs')!.row).toMatchObject({ status: 'shadow_error', error_class: 'SERVER' });
  });
});

describe('STT_PROVIDER=shadow is opt-in per user through the processing job', () => {
  beforeEach(() => vi.stubEnv('STT_PROVIDER', 'shadow'));

  it('no allow-list: the owner audio goes to Deepgram only, nothing is sent to the second vendor and no row is written', async () => {
    await runJob();
    expect(urls.some((u) => u.includes('soniox'))).toBe(false);
    expect(inserts.some((i) => i.table === 'stt_shadow_runs')).toBe(false);
    expect(transcriptRow().transcription_provider).toBe('deepgram');
  });
  it('allow-list that does not include the recording owner: same', async () => {
    vi.stubEnv('STT_SHADOW_USER_IDS', 'someone-else, another');
    await runJob();
    expect(urls.some((u) => u.includes('soniox'))).toBe(false);
    expect(inserts.some((i) => i.table === 'stt_shadow_runs')).toBe(false);
  });
});

describe('default and PDFs', () => {
  it('default env: Soniox is never contacted', async () => {
    await runJob();
    expect(urls.some((u) => u.includes('soniox'))).toBe(false);
    expect(transcriptRow().transcription_provider).toBe('deepgram');
  });
  it('a PDF never reaches any STT provider; label unchanged from before (deepgram/nova-2 when a Deepgram key is set)', async () => {
    fileName = 'u/doc.pdf';
    vi.stubEnv('STT_PROVIDER', 'shadow');
    await runJob();
    expect(urls).toHaveLength(0);
    expect(transcriptRow()).toMatchObject({ transcription_provider: 'deepgram', transcription_model: 'nova-2' });
  });
});
