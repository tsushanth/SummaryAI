// Sweeper: recordings stuck in 'uploading' with no duration are marked failed (status change only, idempotent).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Call = { method: string; args: any[] };
let calls: Call[] = [];
let updateResult: any = { data: [{ id: 'a' }, { id: 'b' }], error: null };

function builder() {
  const q: any = {};
  for (const m of ['update', 'eq', 'is', 'or', 'lt', 'select', 'delete', 'in', 'not']) {
    q[m] = vi.fn((...args: any[]) => { calls.push({ method: m, args }); return q; });
  }
  q.then = (res: any, rej: any) => Promise.resolve(updateResult).then(res, rej);
  return q;
}
const fromSpy = vi.fn((_t: string) => builder());
const removeSpy = vi.fn();
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: { from: (t: string) => fromSpy(t), storage: { from: () => ({ remove: removeSpy }) } },
}));
vi.mock('../src/lib/loopMonitor.js', () => ({
  registerLoop: vi.fn(), runLoopPass: async (_n: string, fn: () => Promise<unknown>) => fn(), reportLoopScanError: vi.fn(),
}));

const { sweepAbandonedUploads, ABANDONED_UPLOAD_CODE, ABANDONED_UPLOAD_MESSAGE } =
  await import('../src/services/abandonedUploadRecovery.js');
const { reportLoopScanError } = await import('../src/lib/loopMonitor.js');

const NOW = Date.parse('2026-11-02T12:00:00Z');
const patch = () => calls.find((c) => c.method === 'update')!.args[0];
const filter = (m: string, key?: string) => calls.filter((c) => c.method === m && (key === undefined || c.args[0] === key));

beforeEach(() => {
  calls = [];
  updateResult = { data: [{ id: 'a' }, { id: 'b' }], error: null };
  fromSpy.mockClear(); removeSpy.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('sweepAbandonedUploads', () => {
  it('only touches the recordings table, as a status change: failed + FAILED_UPLOAD + friendly message', async () => {
    const n = await sweepAbandonedUploads(NOW);
    expect(n).toBe(2);
    expect(fromSpy.mock.calls.every(([t]) => t === 'recordings')).toBe(true);
    expect(patch()).toMatchObject({ status: 'failed', error_code: ABANDONED_UPLOAD_CODE, error_message: ABANDONED_UPLOAD_MESSAGE });
    expect(Object.keys(patch()).sort()).toEqual(['error_code', 'error_message', 'status', 'updated_at']);
    expect(ABANDONED_UPLOAD_CODE).toBe('FAILED_UPLOAD');
  });

  it('never deletes rows or audio', async () => {
    await sweepAbandonedUploads(NOW);
    expect(filter('delete')).toHaveLength(0);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('matches only user uploads still in uploading with no duration, older than 6 h; never bot meeting rows', async () => {
    await sweepAbandonedUploads(NOW);
    expect(filter('eq', 'status')[0].args[1]).toBe('uploading');
    expect(filter('is', 'meeting_id')[0].args[1]).toBeNull();
    const or = filter('or')[0].args[0] as string;
    expect(or).toContain('duration_seconds.is.null');
    expect(or).toContain('duration_seconds.eq.0');
    expect(filter('lt', 'updated_at')[0].args[1]).toBe(new Date(NOW - 6 * 3600 * 1000).toISOString());
  });

  it('threshold hours come from the config', async () => {
    await sweepAbandonedUploads(NOW, { minSummarySeconds: 30, minSummaryWords: 25, abandonedUploadHours: 2 });
    expect(filter('lt', 'updated_at')[0].args[1]).toBe(new Date(NOW - 2 * 3600 * 1000).toISOString());
  });

  it('idempotent: a second pass that matches nothing returns 0 and changes nothing', async () => {
    updateResult = { data: [], error: null };
    expect(await sweepAbandonedUploads(NOW)).toBe(0);
  });

  it('a failed write is reported as a scan error and does not throw', async () => {
    updateResult = { data: null, error: { message: 'boom' } };
    expect(await sweepAbandonedUploads(NOW)).toBe(0);
    expect(reportLoopScanError).toHaveBeenCalledWith('AbandonedUploads');
  });
});
