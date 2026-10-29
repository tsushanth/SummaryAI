import { describe, it, expect, vi, beforeEach } from 'vitest';

const reportFailure = vi.fn();
const updates: { table: string; patch: any }[] = [];
let finalizeResult: any;

function builder(table: string) {
  const q: any = {};
  for (const m of ['select', 'lt', 'limit', 'eq']) q[m] = vi.fn(() => q);
  q.update = vi.fn((patch: any) => { updates.push({ table, patch }); return q; });
  q.single = vi.fn(() => Promise.resolve({
    data: table === 'meetings' ? { id: 'm1', recording_id: 'r1' } : table === 'recordings' ? { id: 'r1', status: 'uploading', file_path: null } : null,
    error: null,
  }));
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: { source: 'meeting_bot', duration_seconds: 0 }, error: null }));
  q.then = (res: any, rej: any) => Promise.resolve({
    data: table === 'bot_runs' ? [{ id: 'b1', meeting_id: 'm1' }] : null, error: null,
  }).then(res, rej);
  return q;
}

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: vi.fn((t: string) => builder(t)) } }));
vi.mock('../src/services/recallService.js', () => ({ finalizeBotRecording: vi.fn(async () => finalizeResult) }));
vi.mock('../src/lib/failureReporter.js', () => ({ reportFailure: (...a: any[]) => reportFailure(...a) }));

const { reconcileStuckBotRecordings } = await import('../src/services/stuckMeetingRecovery.js');

beforeEach(() => {
  reportFailure.mockClear(); updates.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('bot reconciler failure reporting', () => {
  it('no_media marks the recording failed and reports NO_MEDIA once', async () => {
    finalizeResult = { outcome: 'no_media' };
    await reconcileStuckBotRecordings();
    expect(updates.some(u => u.table === 'recordings' && u.patch.status === 'failed')).toBe(true);
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledTimes(1));
    expect(reportFailure.mock.calls[0][2].code).toBe('NO_MEDIA');
  });

  it('a recovered recording reports nothing', async () => {
    finalizeResult = { outcome: 'ok', recordingId: 'r1' };
    await reconcileStuckBotRecordings();
    expect(reportFailure).not.toHaveBeenCalled();
  });
});
