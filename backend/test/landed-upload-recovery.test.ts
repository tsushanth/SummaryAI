// Third sweeper pass: the audio landed in storage but complete-upload never succeeded -> 'uploaded' + process (young) / orphan sweeper (old).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Call = { method: string; args: any[] };
let calls: Call[] = [];
let selectResult: any;
let updateResults: any[];
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
  q.then = (res: any, rej: any) => Promise.resolve(isUpdate ? updateResults.shift() ?? { data: [], error: null } : selectResult).then(res, rej);
  return q;
}
const listSpy = vi.fn(async (dir: string, opts: any) => listResults[`${dir}|${opts.search}`] ?? { data: [], error: null });
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: { from: () => builder(), storage: { from: () => ({ list: listSpy }) } },
}));
vi.mock('../src/lib/loopMonitor.js', () => ({
  registerLoop: vi.fn(), runLoopPass: async (_n: string, fn: () => Promise<unknown>) => fn(), reportLoopScanError: vi.fn(),
}));
const triggerProcessing = vi.fn(async () => ({ id: 'job' }));
vi.mock('../src/services/processingService.js', () => ({ triggerProcessing }));

const { recoverLandedUploads, LANDED_MIN_IDLE_HOURS, LANDED_MAX_TRIGGERS_PER_PASS } = await import('../src/services/abandonedUploadRecovery.js');

const NOW = Date.parse('2026-11-10T12:00:00Z');
const H = 3600 * 1000;
const of = (m: string, key?: string) => calls.filter((c) => c.method === m && (key === undefined || c.args[0] === key));
const row = (o: Record<string, unknown> = {}) => ({ id: 'r1', user_id: 'u1', file_path: 'u1/r1.m4a', file_size_bytes: 1000, created_at: new Date(NOW - 5 * H).toISOString(), ...o });
const landed = (name: string, size: number | undefined) => ({ data: [{ name, metadata: size === undefined ? null : { size } }], error: null });

beforeEach(() => {
  calls = [];
  selectResult = { data: [], error: null };
  updateResults = [];
  listResults = {};
  listSpy.mockClear();
  triggerProcessing.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('recoverLandedUploads', () => {
  it('scans only user uploads still uploading with a length, idle for the signed-URL lifetime', async () => {
    await recoverLandedUploads(NOW);
    expect(of('eq', 'status')[0].args[1]).toBe('uploading');
    expect(of('is', 'meeting_id')[0].args[1]).toBeNull();
    expect(of('gt', 'duration_seconds')[0].args[1]).toBe(0);
    expect(of('lt', 'updated_at')[0].args[1]).toBe(new Date(NOW - LANDED_MIN_IDLE_HOURS * H).toISOString());
    expect(LANDED_MIN_IDLE_HOURS).toBe(1);
  });

  it('object present, size matches, row younger than 24 h: flips to uploaded (guarded on status) and processes it now', async () => {
    selectResult = { data: [row()], error: null };
    listResults['u1|r1.m4a'] = landed('r1.m4a', 1000);
    updateResults = [{ data: [{ id: 'r1' }], error: null }];
    expect(await recoverLandedUploads(NOW)).toBe(1);
    expect(of('update')[0].args[0]).toMatchObject({ status: 'uploaded', file_size_bytes: 1000 });
    expect(of('eq', 'id')[0].args[1]).toBe('r1');
    expect(of('eq', 'status')).toHaveLength(2); // select filter + the guard on the update
    expect(triggerProcessing).toHaveBeenCalledWith('r1', 'u1');
  });

  it('older than 24 h: flipped to uploaded but NOT processed (the orphan sweeper marks it interrupted instead of firing integrations late)', async () => {
    selectResult = { data: [row({ created_at: new Date(NOW - 200 * 24 * H).toISOString() })], error: null };
    listResults['u1|r1.m4a'] = landed('r1.m4a', 1000);
    updateResults = [{ data: [{ id: 'r1' }], error: null }];
    expect(await recoverLandedUploads(NOW)).toBe(1);
    expect(triggerProcessing).not.toHaveBeenCalled();
  });

  it('no object (pass two owns that), size mismatch, or a listing error: nothing is touched', async () => {
    selectResult = { data: [row({ id: 'a', file_path: 'u1/a.m4a' }), row({ id: 'b', file_path: 'u1/b.m4a' }), row({ id: 'c', file_path: 'u1/c.m4a' })], error: null };
    listResults['u1|b.m4a'] = landed('b.m4a', 5000);
    listResults['u1|c.m4a'] = { data: null, error: { message: 'boom' } };
    expect(await recoverLandedUploads(NOW)).toBe(0);
    expect(of('update')).toHaveLength(0);
    expect(triggerProcessing).not.toHaveBeenCalled();
  });

  it('a row that moved on between the scan and the update (0 rows updated) is not processed', async () => {
    selectResult = { data: [row()], error: null };
    listResults['u1|r1.m4a'] = landed('r1.m4a', 1000);
    updateResults = [{ data: [], error: null }];
    expect(await recoverLandedUploads(NOW)).toBe(0);
    expect(triggerProcessing).not.toHaveBeenCalled();
  });

  it('unknown expected size or no object metadata still recovers; a trigger failure does not undo the flip or throw', async () => {
    selectResult = { data: [row({ file_size_bytes: null })], error: null };
    listResults['u1|r1.m4a'] = landed('r1.m4a', undefined);
    updateResults = [{ data: [{ id: 'r1' }], error: null }];
    triggerProcessing.mockRejectedValueOnce(new Error('boom'));
    expect(await recoverLandedUploads(NOW)).toBe(1);
  });

  it('starts at most LANDED_MAX_TRIGGERS_PER_PASS jobs per pass; the other recovered rows are left in uploaded for the orphan sweeper', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    selectResult = { data: ids.map((id) => row({ id, file_path: `u1/${id}.m4a` })), error: null };
    for (const id of ids) listResults[`u1|${id}.m4a`] = landed(`${id}.m4a`, 1000);
    updateResults = ids.map((id) => ({ data: [{ id }], error: null }));
    expect(await recoverLandedUploads(NOW)).toBe(4);
    expect(triggerProcessing).toHaveBeenCalledTimes(LANDED_MAX_TRIGGERS_PER_PASS);
    expect(LANDED_MAX_TRIGGERS_PER_PASS).toBe(2);
  });

  it('scan error returns 0; an update error is skipped', async () => {
    selectResult = { data: null, error: { message: 'db down' } };
    expect(await recoverLandedUploads(NOW)).toBe(0);
    selectResult = { data: [row()], error: null };
    listResults['u1|r1.m4a'] = landed('r1.m4a', 1000);
    updateResults = [{ data: null, error: { message: 'nope' } }];
    expect(await recoverLandedUploads(NOW)).toBe(0);
    expect(triggerProcessing).not.toHaveBeenCalled();
  });
});
