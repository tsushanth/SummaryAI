import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const reportFailure = vi.fn();
const recordingUpdates: any[] = [];
let downloadError: any = null;
let recordingRow: any;

function builder(table: string) {
  const st: any = { table };
  const q: any = {};
  for (const m of ['select', 'in', 'lt', 'not', 'neq', 'order', 'limit']) q[m] = vi.fn(() => q);
  q.eq = vi.fn(() => q);
  q.update = vi.fn((p: any) => { if (table === 'recordings') recordingUpdates.push(p); st.op = 'update'; return q; });
  q.insert = vi.fn(() => Promise.resolve({ error: null }));
  q.single = vi.fn(() => Promise.resolve({ data: recordingRow, error: null }));
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: table === 'recordings' ? { source: 'meeting_bot', duration_seconds: 600 } : null, error: null }));
  q.then = (res: any, rej: any) => Promise.resolve({ data: null, error: null }).then(res, rej);
  return q;
}

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((t: string) => builder(t)),
    storage: { from: () => ({ download: async () => downloadError ? { data: null, error: downloadError } : { data: new Blob(['x']), error: null } }) },
  },
}));
vi.mock('../src/config/index.js', () => ({
  config: { STORAGE_BUCKET_AUDIO: 'audio', ANTHROPIC_API_KEY: '', DEEPGRAM_API_KEY: '' },
}));
vi.mock('../src/services/integrationsService.js', () => ({ dispatchRecordingCompleted: vi.fn() }));
vi.mock('../src/lib/failureReporter.js', () => ({ reportFailure: (...a: any[]) => reportFailure(...a) }));

const { triggerProcessing, getActiveProcessingIds } = await import('../src/services/processingService.js');
const { reportRecordingFailureById, botFailureCode } = await import('../src/lib/recordingFailure.js');

async function runJob() {
  await triggerProcessing('rec-secret-id', 'user-secret-id');
  await vi.waitFor(() => expect(getActiveProcessingIds().size).toBe(0));
}

beforeEach(() => {
  reportFailure.mockClear(); recordingUpdates.length = 0; downloadError = null;
  recordingRow = {
    id: 'rec-secret-id', file_path: 'u/title-secret.m4a', content_type: 'audio/mp4', title: 'Secret board meeting',
    source: 'upload', duration_seconds: 1800, output_language: 'en', recording_type: 'general',
  };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('processing failure reporting', () => {
  it('success: ends completed, clears error_code/error_message, and reports nothing', async () => {
    recordingRow.error_code = 'RECOVERY_RETRY_1';
    await runJob();
    const done = recordingUpdates.find(u => u.status === 'completed');
    expect(done).toBeTruthy();
    expect(done.error_code).toBeNull();
    expect(done.error_message).toBeNull();
    expect(recordingUpdates.some(u => u.status === 'failed')).toBe(false);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('failure: marks failed PROCESSING_ERROR and reports exactly once, with only non-content context', async () => {
    downloadError = { message: 'download of u/title-secret.m4a (123456 bytes) failed' };
    await runJob();
    expect(recordingUpdates.some(u => u.status === 'failed' && u.error_code === 'PROCESSING_ERROR')).toBe(true);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    const [flow, err, ctx] = reportFailure.mock.calls[0];
    expect(flow).toBe('recording_failed');
    expect(err.message).toBe('Recording failed: PROCESSING_ERROR');
    expect(ctx).toEqual({ code: 'PROCESSING_ERROR', source: 'upload', audio_minutes: '30', stage: 'transcribing' });
    const blob = JSON.stringify(reportFailure.mock.calls[0]);
    for (const secret of ['rec-secret-id', 'user-secret-id', 'Secret board meeting', 'title-secret', '123456']) {
      expect(blob).not.toContain(secret);
    }
  });
});

describe('bot-path failure reporting', () => {
  it('maps messages to stable codes', () => {
    expect(botFailureCode('No recording URL available')).toBe('NO_MEDIA');
    expect(botFailureCode('No recording URL available (reconciled after missing webhook)')).toBe('NO_MEDIA');
    expect(botFailureCode('Recording could not be stored: boom')).toBe('BOT_RECORDING_FAILED');
  });

  it('reports by recording id with looked-up source and minutes, never the id', async () => {
    reportRecordingFailureById('rec-secret-id', 'BOT_FATAL');
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledTimes(1));
    const [flow, err, ctx] = reportFailure.mock.calls[0];
    expect(flow).toBe('recording_failed');
    expect(err.message).toBe('Recording failed: BOT_FATAL');
    expect(ctx).toEqual({ code: 'BOT_FATAL', source: 'meeting_bot', audio_minutes: '10', stage: 'unknown' });
    expect(JSON.stringify(reportFailure.mock.calls[0])).not.toContain('rec-secret-id');
  });
});
