import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ table: string; op: string; args: any[] }> = [];
let data: Record<string, any> = {};

vi.mock('../src/lib/failureReporter.js', () => ({ reportFailure: vi.fn(), reportBackendError: vi.fn() }));
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (t: string) => {
      const q: any = {};
      for (const m of ['select', 'in', 'lt', 'gte', 'eq', 'limit', 'or']) q[m] = (...args: any[]) => { calls.push({ table: t, op: m, args }); return q; };
      q.then = (res: any, rej: any) => Promise.resolve(data[t] ?? { data: [], count: 0, error: null }).then(res, rej);
      return q;
    },
  },
}));

const alerts = await import('../src/lib/alerts.js');
const loops = await import('../src/lib/loopMonitor.js');
const { checkPipelineInvariants } = await import('../src/services/pipelineInvariants.js');

beforeEach(() => {
  calls.length = 0; data = {};
  alerts.resetAlertThrottle(); loops.resetLoopMonitor();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const NOW = Date.parse('2026-11-04T12:00:00Z');

describe('COMPLETED_NO_SUMMARY', () => {
  it('does not fire for recordings the short-recording guard completed on purpose (NO_SPEECH / TOO_SHORT write no summary row)', async () => {
    data = {
      recordings: { data: [{ id: 'r1', error_code: 'NO_SPEECH' }, { id: 'r2', error_code: 'TOO_SHORT' }], count: 0, error: null },
      summaries: { data: [], error: null },
    };
    const out = await checkPipelineInvariants(NOW);
    expect(out.find((o) => o.code === 'COMPLETED_NO_SUMMARY')).toBeUndefined();
  });

  it('still fires for a completed recording with no summary and no guard code, counting only those', async () => {
    data = {
      recordings: { data: [{ id: 'r1', error_code: 'NO_SPEECH' }, { id: 'r3', error_code: null }, { id: 'r4', error_code: null }], count: 0, error: null },
      summaries: { data: [{ recording_id: 'r4' }], error: null },
    };
    const out = await checkPipelineInvariants(NOW);
    expect(out.find((o) => o.code === 'COMPLETED_NO_SUMMARY')?.count).toBe(1);
  });

  it('asks the database to skip guard codes too, so they cannot crowd real rows out of the 500-row page', async () => {
    data = { recordings: { data: [{ id: 'r3', error_code: null }], count: 0, error: null }, summaries: { data: [], error: null } };
    await checkPipelineInvariants(NOW);
    const or = calls.find((c) => c.table === 'recordings' && c.op === 'or');
    expect(or?.args[0]).toBe('error_code.is.null,error_code.not.in.(NO_SPEECH,TOO_SHORT)');
  });
});
