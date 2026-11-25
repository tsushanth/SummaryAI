import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Row counts per query of the 24 h window, told apart by the filters each query applies. */
let window24h = { created: 0, completedWithSpeech: 0, failed: 0, emptyTaps: 0 };
vi.mock('../src/lib/failureReporter.js', () => ({ reportFailure: vi.fn(), reportBackendError: vi.fn() }));
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const eq: Record<string, unknown> = {};
      let head = false;
      const q: any = {};
      for (const m of ['in', 'lt', 'gte', 'limit', 'or']) q[m] = () => q;
      q.select = (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return q; };
      q.eq = (c: string, v: unknown) => { eq[c] = v; return q; };
      q.then = (res: any, rej: any) => {
        const dayWindow = table === 'recordings' && head;
        const count = !dayWindow ? 0
          : eq.status === 'completed' ? window24h.completedWithSpeech
          : eq.status === 'failed' ? window24h.failed
          : eq.error_code === 'NO_SPEECH' ? window24h.emptyTaps
          : null;
        // The stuck-recordings query has no gte/eq of its own; the "created" query is the only other head count.
        return Promise.resolve({ data: [], count: count ?? window24h.created, error: null }).then(res, rej);
      };
      return q;
    },
  },
}));

const alerts = await import('../src/lib/alerts.js');
const { checkPipelineInvariants } = await import('../src/services/pipelineInvariants.js');

const run = async (w: typeof window24h) => {
  window24h = w;
  return (await checkPipelineInvariants()).filter((o) => o.code !== 'STUCK_RECORDINGS').map((o) => [o.code, o.count]);
};
beforeEach(() => { alerts.resetAlertThrottle(); });

describe('ZERO_SUCCESS_24H', () => {
  it('fires when every real attempt ended without speech', async () => {
    expect(await run({ created: 5, completedWithSpeech: 0, failed: 0, emptyTaps: 1 })).toEqual([['ZERO_SUCCESS_24H', 4]]);
  });
  it('stays quiet when too few were real attempts', async () => {
    expect(await run({ created: 5, completedWithSpeech: 0, failed: 0, emptyTaps: 3 })).toEqual([]);
  });
  it('stays quiet when one recording had speech', async () => {
    expect(await run({ created: 5, completedWithSpeech: 1, failed: 0, emptyTaps: 0 })).toEqual([]);
  });
  it('still reports a high failure rate', async () => {
    expect(await run({ created: 6, completedWithSpeech: 3, failed: 3, emptyTaps: 0 })).toEqual([['HIGH_FAILURE_RATE_24H', 3]]);
  });
});
