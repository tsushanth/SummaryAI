// processRecordingAsync (via triggerProcessing): short / empty recordings skip the LLM and the summaries row.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const anthropicCreate = vi.fn();
const dispatch = vi.fn();
const recordingUpdates: any[] = [];
const inserts: { table: string; row: any }[] = [];
let recordingRow: any;
let deepgramBody: any;

function builder(table: string) {
  const q: any = {};
  for (const m of ['select', 'in', 'lt', 'not', 'neq', 'order', 'limit', 'eq']) q[m] = vi.fn(() => q);
  q.update = vi.fn((p: any) => { if (table === 'recordings') recordingUpdates.push(p); return q; });
  q.insert = vi.fn((row: any) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); });
  q.single = vi.fn(() => Promise.resolve({ data: recordingRow, error: null }));
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  q.then = (res: any, rej: any) => Promise.resolve({ data: null, error: null }).then(res, rej);
  return q;
}

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((t: string) => builder(t)),
    storage: { from: () => ({ download: async () => ({ data: new Blob(['x']), error: null }) }) },
  },
}));
vi.mock('../src/config/index.js', () => ({
  config: { STORAGE_BUCKET_AUDIO: 'audio', ANTHROPIC_API_KEY: 'sk-test', DEEPGRAM_API_KEY: 'dg-test', SUMMARY_MODEL: 'm' },
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: anthropicCreate }; } }));
vi.mock('../src/lib/llm.js', () => ({ instrumentAnthropic: <T>(c: T) => c, withFeature: <T>(_n: string, fn: () => T) => fn() }));
vi.mock('../src/services/integrationsService.js', () => ({ dispatchRecordingCompleted: (...a: any[]) => dispatch(...a) }));
vi.mock('pdf-parse', () => ({ default: async () => ({ text: 'Tiny doc.' }) }));

const { triggerProcessing, getActiveProcessingIds } = await import('../src/services/processingService.js');

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
function deepgram(text: string, duration?: number) {
  return {
    metadata: duration === undefined ? {} : { duration },
    results: {
      channels: [{ detected_language: 'en', alternatives: [{ transcript: text }] }],
      utterances: text ? [{ speaker: 0, transcript: text, start: 0, end: duration ?? 1, confidence: 0.9 }] : [],
    },
  };
}
async function runJob() {
  await triggerProcessing('rec-1', 'user-1');
  await vi.waitFor(() => expect(getActiveProcessingIds().size).toBe(0));
}
const completion = () => recordingUpdates.find((u) => u.status === 'completed');
const summaryInserts = () => inserts.filter((i) => i.table === 'summaries');

beforeEach(() => {
  anthropicCreate.mockReset();
  anthropicCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ summary: 'S', key_points: ['k'], action_items: [], topics: [] }) }],
    stop_reason: 'end_turn',
  });
  dispatch.mockReset();
  recordingUpdates.length = 0;
  inserts.length = 0;
  recordingRow = { id: 'rec-1', file_path: 'u/r.m4a', content_type: 'audio/mp4', source: 'upload', duration_seconds: 20, recording_type: 'general' };
  deepgramBody = deepgram(words(5), 4);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => deepgramBody, text: async () => '' })));
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('short recordings', () => {
  it('a 4 s, 5-word probe: no LLM call, no summaries row, completed + TOO_SHORT, integrations not fired', async () => {
    await runJob();
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(summaryInserts()).toHaveLength(0);
    expect(completion()).toMatchObject({ status: 'completed', error_code: 'TOO_SHORT', word_count: 5 });
    expect(completion().processed_at).toBeTruthy();
    expect(recordingUpdates.some((u) => u.status === 'failed')).toBe(false);
    expect(recordingUpdates.some((u) => u.status === 'summarizing')).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    // the transcript is still stored (nothing is thrown away)
    expect(inserts.some((i) => i.table === 'transcripts')).toBe(true);
  });

  it('silence (0 words): NO_SPEECH', async () => {
    deepgramBody = deepgram('', 12);
    await runJob();
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(summaryInserts()).toHaveLength(0);
    expect(completion()).toMatchObject({ status: 'completed', error_code: 'NO_SPEECH', word_count: 0 });
  });

  it('a 10 s clip with 20 words is too short', async () => {
    recordingRow.duration_seconds = 600; // client value is overridden by the provider duration
    deepgramBody = deepgram(words(20), 10);
    await runJob();
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(completion()).toMatchObject({ error_code: 'TOO_SHORT' });
  });

  it('a 29 s clip with 59 words is too short', async () => {
    deepgramBody = deepgram(words(59), 29);
    await runJob();
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(completion()).toMatchObject({ error_code: 'TOO_SHORT' });
  });

  it('long clip with under 25 words is too short', async () => {
    recordingRow.duration_seconds = 300;
    deepgramBody = deepgram(words(24), 300);
    await runJob();
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(completion()).toMatchObject({ error_code: 'TOO_SHORT' });
  });
});

describe('recordings at or above the threshold are unchanged', () => {
  it('a dense 25 s dictation (80 words) is summarised', async () => {
    recordingRow.duration_seconds = 25;
    deepgramBody = deepgram(words(80), 25);
    await runJob();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(summaryInserts()).toHaveLength(1);
    expect(completion().error_code).toBeNull();
  });

  it('a 29 s clip with exactly 60 words is summarised', async () => {
    deepgramBody = deepgram(words(60), 29);
    await runJob();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(completion().error_code).toBeNull();
  });

  it('exactly 30 s and 25 words: summarised, error_code cleared, integrations fired', async () => {
    recordingRow.duration_seconds = 30;
    recordingRow.error_code = 'RECOVERY_RETRY_1';
    deepgramBody = deepgram(words(25), 30);
    await runJob();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(summaryInserts()).toHaveLength(1);
    expect(completion()).toMatchObject({ status: 'completed', error_code: null, error_message: null });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('provider reports no duration: falls back to the client duration and words', async () => {
    recordingRow.duration_seconds = 90;
    deepgramBody = deepgram(words(60));
    await runJob();
    expect(summaryInserts()).toHaveLength(1);
    expect(completion().error_code).toBeNull();
  });

  it('a 2-minute Chinese recording (no spaces, whitespace word count ~3) is still summarised', async () => {
    recordingRow.duration_seconds = 120;
    deepgramBody = deepgram('今天我们讨论一下第三季度的目标和进展情况。 ' + '我们需要在下周之前完成所有的准备工作并且安排下一次会议的时间。'.repeat(3), 120);
    await runJob();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(completion().error_code).toBeNull();
  });

  it('a tiny PDF import is still summarised (documents are never gated)', async () => {
    recordingRow = { ...recordingRow, file_path: 'u/doc.pdf', content_type: 'application/pdf', duration_seconds: null };
    await runJob();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(summaryInserts()).toHaveLength(1);
    expect(completion().error_code).toBeNull();
  });
});
