import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeDb } from './helpers-fakeDb.js';

const db = new FakeDb();
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: (t: string) => db.from(t) } }));
vi.mock('../src/lib/failureReporter.js', () => ({ reportFailure: vi.fn(), reportBackendError: vi.fn() }));
vi.mock('../src/services/recallService.js', () => ({ finalizeBotRecording: vi.fn(), RecallService: {} }));

const { closeMeetingsOfClosedRuns, STALE_MEETING_MS } = await import('../src/services/stuckMeetingRecovery.js');

const NOW = Date.parse('2026-11-25T12:00:00Z');
const old = new Date(NOW - STALE_MEETING_MS - 1000).toISOString();
const meeting = (status: string, runs: Array<Record<string, unknown>>, updated_at = old) => {
  const m = db.seed('meetings', { status, updated_at, error_message: null });
  for (const r of runs) db.seed('bot_runs', { meeting_id: m.id, error_code: null, error_message: null, ...r });
  return m;
};
beforeEach(() => { db.tables = {}; db.log = []; vi.spyOn(console, 'log').mockImplementation(() => {}); });

describe('closeMeetingsOfClosedRuns', () => {
  it('closes a stale meeting the way its newest bot run ended', async () => {
    const failed = meeting('bot_joining', [{ status: 'failed', error_code: 'STATUS_NEVER_REPORTED' }]);
    const done = meeting('bot_left', [{ status: 'failed', error_code: 'x' }, { status: 'completed' }]);
    expect(await closeMeetingsOfClosedRuns(NOW)).toBe(2);
    expect(failed).toMatchObject({ status: 'failed', error_message: 'STATUS_NEVER_REPORTED' });
    expect(done).toMatchObject({ status: 'completed', error_message: null });
    expect(db.log.filter((l) => l.op === 'update').every((l) => l.table === 'meetings')).toBe(true);
  });

  it('leaves alone: an open newest run, no run, a recent meeting, a meeting that is not waiting on a bot', async () => {
    const rows = [
      meeting('bot_joining', [{ status: 'failed' }, { status: 'joining' }]),
      meeting('bot_left', [{ status: 'processing' }]),
      meeting('bot_joining', []),
      meeting('bot_joining', [{ status: 'failed' }], new Date(NOW - 3600_000).toISOString()),
      meeting('scheduled', [{ status: 'failed' }]),
    ];
    const before = rows.map((r) => r.status);
    expect(await closeMeetingsOfClosedRuns(NOW)).toBe(0);
    expect(rows.map((r) => r.status)).toEqual(before);
  });
});
