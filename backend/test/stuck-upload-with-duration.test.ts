// Second sweeper pass: 'uploading' rows that DO have a length, older than 24 h, with no audio object in storage -> failed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Call = { method: string; args: any[] };
let calls: Call[] = [];
let selectResult: any;
let updateResult: any;
let listResults: Record<string, any>;

function builder() {
  const q: any = {};
  let isUpdate = false;
  for (const m of ['select', 'update', 'eq', 'is', 'gt', 'not', 'lt', 'limit', 'in']) {
    q[m] = vi.fn((...args: any[]) => {
      calls.push({ method: m, args });
      if (m === 'update') isUpdate = true;
      return q;
    });
  }
  q.then = (res: any, rej: any) => Promise.resolve(isUpdate ? updateResult : selectResult).then(res, rej);
  return q;
}
const listSpy = vi.fn(async (dir: string, opts: any) => listResults[`${dir}|${opts.search}`] ?? { data: [], error: null });
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: { from: () => builder(), storage: { from: () => ({ list: listSpy }) } },
}));
vi.mock('../src/lib/loopMonitor.js', () => ({
  registerLoop: vi.fn(), runLoopPass: async (_n: string, fn: () => Promise<unknown>) => fn(), reportLoopScanError: vi.fn(),
}));

const { sweepStuckUploadsWithDuration, STUCK_WITH_DURATION_HOURS, ABANDONED_UPLOAD_CODE } =
  await import('../src/services/abandonedUploadRecovery.js');

const NOW = Date.parse('2026-11-05T12:00:00Z');
const of = (m: string, key?: string) => calls.filter((c) => c.method === m && (key === undefined || c.args[0] === key));

beforeEach(() => {
  calls = [];
  selectResult = { data: [], error: null };
  updateResult = { data: [], error: null };
  listResults = {};
  listSpy.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('sweepStuckUploadsWithDuration', () => {
  it('selects only user uploads still uploading with a length, untouched for 24 h', async () => {
    await sweepStuckUploadsWithDuration(NOW);
    expect(of('eq', 'status')[0].args[1]).toBe('uploading');
    expect(of('is', 'meeting_id')[0].args[1]).toBeNull();
    expect(of('gt', 'duration_seconds')[0].args[1]).toBe(0);
    expect(of('lt', 'updated_at')[0].args[1]).toBe(new Date(NOW - STUCK_WITH_DURATION_HOURS * 3600 * 1000).toISOString());
    expect(STUCK_WITH_DURATION_HOURS).toBe(24);
  });

  it('marks a row failed only when storage shows no object for it', async () => {
    selectResult = { data: [{ id: 'gone', file_path: 'u1/gone.mp4' }, { id: 'landed', file_path: 'u1/landed.mp4' }], error: null };
    listResults['u1|landed.mp4'] = { data: [{ name: 'landed.mp4' }], error: null };
    updateResult = { data: [{ id: 'gone' }], error: null };
    const n = await sweepStuckUploadsWithDuration(NOW);
    expect(n).toBe(1);
    expect(of('in')[0].args).toEqual(['id', ['gone']]);
    const patch = of('update')[0].args[0];
    expect(patch).toMatchObject({ status: 'failed', error_code: ABANDONED_UPLOAD_CODE });
    expect(of('eq', 'status')).toHaveLength(2); // select filter + the guard on the update
  });

  it('a storage listing error is treated as "maybe exists": nothing is marked', async () => {
    selectResult = { data: [{ id: 'x', file_path: 'u1/x.mp4' }], error: null };
    listResults['u1|x.mp4'] = { data: null, error: { message: 'boom' } };
    expect(await sweepStuckUploadsWithDuration(NOW)).toBe(0);
    expect(of('update')).toHaveLength(0);
  });

  it('no candidates: no update at all; a scan error returns 0', async () => {
    expect(await sweepStuckUploadsWithDuration(NOW)).toBe(0);
    expect(of('update')).toHaveLength(0);
    selectResult = { data: null, error: { message: 'db down' } };
    expect(await sweepStuckUploadsWithDuration(NOW)).toBe(0);
  });
});
