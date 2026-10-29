import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fake Supabase: the scan returns `scanRows`; updates are recorded and succeed unless claimResults says otherwise.
let scanRows: any[] = [];
let scanError: any = null;
let claimResults: boolean[] = [];
const ops: { table: string; op: string; patch?: any; filters: Record<string, any> }[] = [];
const order: string[] = [];
const activeIds = new Set<string>();

function builder(table: string) {
  const state: any = { table, filters: {} };
  const q: any = {};
  q.select = vi.fn((_c?: string) => { if (state.op === 'update') return q; state.op = 'select'; return q; });
  for (const m of ['in', 'lt', 'not', 'neq', 'order', 'limit']) q[m] = vi.fn(() => q);
  q.eq = vi.fn((k: string, v: any) => { state.filters[k] = v; return q; });
  q.update = vi.fn((patch: any) => { state.op = 'update'; state.patch = patch; return q; });
  q.delete = vi.fn(() => { state.op = 'delete'; return q; });
  q.then = (res: any, rej: any) => {
    let result: any;
    if (state.op === 'select') result = { data: scanRows, error: scanError };
    else if (state.op === 'update') {
      const ok = claimResults.length ? claimResults.shift()! : true;
      ops.push({ table, op: 'update', patch: state.patch, filters: state.filters });
      order.push(`update:${state.patch.error_code ?? state.patch.status}`);
      result = { data: ok ? [{ id: state.filters.id }] : [], error: null };
    } else {
      ops.push({ table, op: 'delete', filters: state.filters });
      order.push(`delete:${table}`);
      result = { data: null, error: null };
    }
    return Promise.resolve(result).then(res, rej);
  };
  return q;
}

const triggerProcessing = vi.fn(async (id: string) => { order.push(`trigger:${id}`); return { id: 'job' }; });
const reportFailure = vi.fn();

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: vi.fn((t: string) => builder(t)) } }));
vi.mock('../src/services/processingService.js', () => ({
  triggerProcessing: (id: string, u: string) => triggerProcessing(id, u),
  getActiveProcessingIds: () => activeIds,
}));
vi.mock('../src/lib/failureReporter.js', () => ({ reportFailure: (...a: any[]) => reportFailure(...a) }));

const {
  recoverOrphanedProcessing, INTERRUPTED_MESSAGE, ORPHAN_MIN_AGE_MS,
} = await import('../src/services/orphanedProcessingRecovery.js');

const NOW = Date.parse('2026-10-29T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

function row(id: string, o: Partial<any> = {}) {
  return {
    id, user_id: 'user-secret-1', status: 'transcribing', source: 'meeting_bot', duration_seconds: 16140,
    error_code: null, created_at: iso(2 * HOUR), updated_at: iso(2 * HOUR), ...o,
  };
}

beforeEach(() => {
  scanRows = []; scanError = null; claimResults = []; ops.length = 0; order.length = 0; activeIds.clear();
  triggerProcessing.mockClear(); reportFailure.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const updates = () => ops.filter(o => o.op === 'update');

describe('recoverOrphanedProcessing', () => {
  it('retries a young orphan once: marker written BEFORE partial rows are deleted and BEFORE the re-trigger', async () => {
    scanRows = [row('aaaaaaaa-1111')];
    await recoverOrphanedProcessing(NOW);
    expect(order).toEqual([
      'update:RECOVERY_RETRY_1', 'delete:transcripts', 'delete:summaries', 'trigger:aaaaaaaa-1111',
    ]);
    expect(updates()[0].patch).toMatchObject({ status: 'uploaded', error_code: 'RECOVERY_RETRY_1', error_message: null });
    expect(triggerProcessing).toHaveBeenCalledWith('aaaaaaaa-1111', 'user-secret-1');
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0][0]).toBe('recording_recovery_retry');
  });

  it('claims with compare-and-set on the seen status and updated_at', async () => {
    const r = row('aaaaaaaa-1111');
    scanRows = [r];
    await recoverOrphanedProcessing(NOW);
    expect(updates()[0].filters).toMatchObject({ id: r.id, status: 'transcribing', updated_at: r.updated_at });
  });

  it('second pass: an already-retried orphan is marked failed PROCESSING_INTERRUPTED, not retried', async () => {
    scanRows = [row('bbbbbbbb-2222', { error_code: 'RECOVERY_RETRY_1', status: 'summarizing' })];
    await recoverOrphanedProcessing(NOW);
    expect(triggerProcessing).not.toHaveBeenCalled();
    expect(ops.filter(o => o.op === 'delete')).toHaveLength(0);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].patch).toMatchObject({
      status: 'failed', error_code: 'PROCESSING_INTERRUPTED', error_message: INTERRUPTED_MESSAGE,
    });
  });

  it('older than 24h (65-day production example) is failed on the first pass and never re-triggered', async () => {
    scanRows = [row('cccccccc-3333', { created_at: iso(65 * DAY), updated_at: iso(65 * DAY) })];
    await recoverOrphanedProcessing(NOW);
    expect(triggerProcessing).not.toHaveBeenCalled();
    expect(ops.filter(o => o.op === 'delete')).toHaveLength(0);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].patch).toMatchObject({ status: 'failed', error_code: 'PROCESSING_INTERRUPTED' });
    expect(updates()[0].patch.error_message).toMatch(/Tap retry/);
  });

  it('scan filters on status list, idle threshold and file_path (45 min default)', async () => {
    const { supabaseAdmin } = await import('../src/lib/supabase.js');
    await recoverOrphanedProcessing(NOW);
    expect(ORPHAN_MIN_AGE_MS).toBe(45 * MIN);
    const q = (supabaseAdmin.from as any).mock.results.at(-1).value;
    expect(q.in).toHaveBeenCalledWith('status', ['transcribing', 'summarizing', 'transcribed', 'uploaded']);
    expect(q.lt).toHaveBeenCalledWith('updated_at', new Date(NOW - 45 * MIN).toISOString());
    expect(q.not).toHaveBeenCalledWith('file_path', 'is', null);
  });

  it('touches nothing when the scan returns no rows (recently updated, completed and failed rows are filtered out by the query)', async () => {
    scanRows = [];
    await recoverOrphanedProcessing(NOW);
    expect(ops).toHaveLength(0);
    expect(triggerProcessing).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('a scan error does nothing', async () => {
    scanError = { message: 'db down' };
    await recoverOrphanedProcessing(NOW);
    expect(ops).toHaveLength(0);
  });

  it('handles at most 2 orphans per pass', async () => {
    scanRows = ['a', 'b', 'c', 'd', 'e'].map(c => row(`${c}0000000-x`, { created_at: iso(30 * DAY), updated_at: iso(30 * DAY) }));
    await recoverOrphanedProcessing(NOW);
    expect(updates()).toHaveLength(2);
    expect(triggerProcessing).not.toHaveBeenCalled();
  });

  it('re-triggers at most one recording per pass (sequential, no concurrent heavy jobs)', async () => {
    scanRows = [row('a0000000-x'), row('b0000000-x'), row('c0000000-x')];
    await recoverOrphanedProcessing(NOW);
    expect(triggerProcessing).toHaveBeenCalledTimes(1);
    expect(triggerProcessing).toHaveBeenCalledWith('a0000000-x', 'user-secret-1');
    expect(updates()).toHaveLength(1);
  });

  it('a lost compare-and-set claim skips the recording: no delete, no trigger, no report', async () => {
    scanRows = [row('dddddddd-4444')];
    claimResults = [false];
    await recoverOrphanedProcessing(NOW);
    expect(ops.filter(o => o.op === 'delete')).toHaveLength(0);
    expect(triggerProcessing).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('a lost claim on a fail-mark does not report a failure', async () => {
    scanRows = [row('eeeeeeee-5555', { created_at: iso(3 * DAY) })];
    claimResults = [false];
    await recoverOrphanedProcessing(NOW);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('skips a recording whose job is active in this process; defers retries while any job is active', async () => {
    scanRows = [row('ffffffff-6666'), row('gggggggg-7777', { created_at: iso(5 * DAY) })];
    activeIds.add('ffffffff-6666');
    await recoverOrphanedProcessing(NOW);
    expect(triggerProcessing).not.toHaveBeenCalled();
    // the old one is still failed (cheap, safe); the active one is untouched
    expect(updates()).toHaveLength(1);
    expect(updates()[0].filters.id).toBe('gggggggg-7777');

    ops.length = 0;
    scanRows = [row('hhhhhhhh-8888')];
    activeIds.clear(); activeIds.add('some-other-job');
    await recoverOrphanedProcessing(NOW);
    expect(ops).toHaveLength(0);
  });
});

describe('failure reporting from the recovery pass', () => {
  it('reports PROCESSING_INTERRUPTED once with only non-content context and a stable message', async () => {
    scanRows = [row('iiiiiiii-9999', { created_at: iso(65 * DAY), updated_at: iso(65 * DAY) })];
    await recoverOrphanedProcessing(NOW);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    const [flow, err, ctx] = reportFailure.mock.calls[0];
    expect(flow).toBe('recording_failed');
    expect(err.message).toBe('Recording failed: PROCESSING_INTERRUPTED');
    expect(ctx).toEqual({ code: 'PROCESSING_INTERRUPTED', source: 'meeting_bot', audio_minutes: '269', stage: 'transcribing' });
    const blob = JSON.stringify(reportFailure.mock.calls[0]);
    expect(blob).not.toContain('user-secret-1');
    expect(blob).not.toContain('iiiiiiii');
  });

  it('reports the retry with a stable message and non-content context', async () => {
    scanRows = [row('jjjjjjjj-0000')];
    await recoverOrphanedProcessing(NOW);
    const [flow, err, ctx] = reportFailure.mock.calls[0];
    expect(flow).toBe('recording_recovery_retry');
    expect(err.message).toBe('Recording processing retried after interruption');
    expect(Object.keys(ctx).sort()).toEqual(['audio_minutes', 'code', 'source', 'stage']);
    expect(JSON.stringify(reportFailure.mock.calls[0])).not.toContain('jjjjjjjj');
  });
});
