// The recording's stored length (recordings.duration_seconds, what the web/Android detail pages show) stayed NULL for clips whose
// client sent no duration (the web app never did), although the transcription provider had measured it. After transcription the
// measured value is now stored when the client value is missing; a valid client value is never overwritten.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const anthropicCreate = vi.fn();
type Upd = { table: string; payload: any; filters: Array<[string, ...any[]]> };
const updates: Upd[] = [];
const inserts: { table: string; row: any }[] = [];
let recordingRow: any;
let deepgramBody: any;
let durationUpdateError: any = null;

function builder(table: string) {
  const q: any = {};
  let current: Upd | null = null;
  for (const m of ['select', 'in', 'lt', 'not', 'neq', 'order', 'limit']) q[m] = vi.fn(() => q);
  q.eq = vi.fn((...a: any[]) => { current?.filters.push(['eq', ...a]); return q; });
  q.is = vi.fn((...a: any[]) => { current?.filters.push(['is', ...a]); return q; });
  q.or = vi.fn((...a: any[]) => { current?.filters.push(['or', ...a]); return q; });
  q.update = vi.fn((p: any) => { current = { table, payload: p, filters: [] }; updates.push(current); return q; });
  q.insert = vi.fn((row: any) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); });
  q.single = vi.fn(() => Promise.resolve({ data: recordingRow, error: null }));
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  q.then = (res: any, rej: any) => {
    const isDur = current && table === 'recordings' && 'duration_seconds' in current.payload && Object.keys(current.payload).length === 1;
    return Promise.resolve({ data: null, error: isDur ? durationUpdateError : null }).then(res, rej);
  };
  return q;
}

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((t: string) => builder(t)),
    storage: { from: () => ({ download: async () => ({ data: new Blob(['x']), error: null }) }) },
  },
}));
vi.mock('../src/config/index.js', () => ({
  config: { STORAGE_BUCKET_AUDIO: 'audio', ANTHROPIC_API_KEY: 'sk-test', DEEPGRAM_API_KEY: 'dg-test', SUMMARY_MODEL: 'm', MAX_RECORDING_DURATION_SECONDS: 14400 },
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: anthropicCreate }; } }));
vi.mock('../src/lib/llm.js', () => ({ instrumentAnthropic: <T>(c: T) => c, withFeature: <T>(_n: string, fn: () => T) => fn() }));
vi.mock('../src/services/integrationsService.js', () => ({ dispatchRecordingCompleted: vi.fn() }));
vi.mock('pdf-parse', () => ({ default: async () => ({ text: 'Tiny doc.' }) }));

const { triggerProcessing, getActiveProcessingIds } = await import('../src/services/processingService.js');
const { measuredDurationToStore } = await import('../src/services/recordingDuration.js');

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
const durationUpdates = () => updates.filter((u) => u.table === 'recordings' && Object.keys(u.payload).length === 1 && 'duration_seconds' in u.payload);

beforeEach(() => {
  anthropicCreate.mockReset();
  anthropicCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ summary: 'S', key_points: ['k'], action_items: [], topics: [] }) }],
    stop_reason: 'end_turn',
  });
  updates.length = 0;
  inserts.length = 0;
  durationUpdateError = null;
  recordingRow = { id: 'rec-1', file_path: 'u/r.webm', content_type: 'audio/webm', source: 'upload', duration_seconds: null, recording_type: 'general' };
  deepgramBody = deepgram(words(80), 44.6);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => deepgramBody, text: async () => '' })));
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('measuredDurationToStore', () => {
  it('rounds the provider duration to a positive integer', () => {
    expect(measuredDurationToStore(44.6, null)).toBe(45);
    expect(measuredDurationToStore(20.2, undefined)).toBe(20);
    expect(measuredDurationToStore(0.6, null)).toBe(1);
  });
  it('a valid client duration is never overwritten', () => {
    expect(measuredDurationToStore(44.6, 45)).toBeNull();
    expect(measuredDurationToStore(100, 3)).toBeNull();
  });
  it('a 0 client duration counts as missing', () => {
    expect(measuredDurationToStore(44.6, 0)).toBe(45);
  });
  it('unknown, zero, negative, non-finite or absurd provider values store nothing', () => {
    for (const v of [null, undefined, 0, 0.4, -5, NaN, Infinity, 14401 * 1000]) expect(measuredDurationToStore(v as any, null)).toBeNull();
  });
});

describe('processing stores the provider-measured duration', () => {
  it('client sent no duration: the measured one is written to duration_seconds, only where it is still missing', async () => {
    await runJob();
    const d = durationUpdates();
    expect(d).toHaveLength(1);
    expect(d[0].payload).toEqual({ duration_seconds: 45 });
    expect(d[0].filters).toContainEqual(['eq', 'id', 'rec-1']);
    // guarded in SQL too (idempotent, race-safe): only rows whose duration is still NULL/0 are touched
    expect(d[0].filters).toContainEqual(['or', 'duration_seconds.is.null,duration_seconds.eq.0']);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it('client sent 0 (stored as NULL by the API, or 0 on older rows): treated as missing', async () => {
    recordingRow.duration_seconds = 0;
    await runJob();
    expect(durationUpdates()).toHaveLength(1);
  });

  it('a valid client duration is left alone (no write at all)', async () => {
    recordingRow.duration_seconds = 50;
    await runJob();
    expect(durationUpdates()).toHaveLength(0);
  });

  it('provider reports no duration: nothing to store, processing still completes', async () => {
    deepgramBody = deepgram(words(80));
    await runJob();
    expect(durationUpdates()).toHaveLength(0);
    expect(updates.some((u) => u.payload.status === 'completed')).toBe(true);
  });

  it('also stored for a too-short clip (the early-return path)', async () => {
    deepgramBody = deepgram(words(5), 4.2);
    await runJob();
    expect(durationUpdates()[0]?.payload).toEqual({ duration_seconds: 4 });
    expect(updates.find((u) => u.payload.status === 'completed')).toMatchObject({ payload: { error_code: 'TOO_SHORT' } });
  });

  it('a failing duration write never fails the recording', async () => {
    durationUpdateError = { message: 'boom' };
    await runJob();
    expect(updates.some((u) => u.payload.status === 'failed')).toBe(false);
    expect(updates.some((u) => u.payload.status === 'completed')).toBe(true);
  });

  it('documents (PDF) never get a duration', async () => {
    recordingRow = { ...recordingRow, file_path: 'u/doc.pdf', content_type: 'application/pdf' };
    await runJob();
    expect(durationUpdates()).toHaveLength(0);
  });
});
