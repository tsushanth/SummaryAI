import { describe, it, expect, vi, beforeEach } from 'vitest';

const reportFailure = vi.fn();
const calls: Array<{ table: string; op: string; args: any[] }> = [];
const updates: Array<{ table: string; patch: any }> = [];
let data: Record<string, any> = {};

vi.mock('../src/lib/failureReporter.js', () => ({
  reportFailure: (...a: any[]) => reportFailure(...a),
  reportBackendError: vi.fn(),
}));
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (t: string) => {
      const q: any = {};
      for (const m of ['select', 'in', 'lt', 'gte', 'eq', 'limit']) q[m] = (...args: any[]) => { calls.push({ table: t, op: m, args }); return q; };
      q.update = (patch: any) => { updates.push({ table: t, patch }); return q; };
      q.maybeSingle = () => Promise.resolve(data[t + ':one'] ?? { data: null, error: null });
      q.then = (res: any, rej: any) => Promise.resolve(data[t] ?? { data: [], count: 0, error: null }).then(res, rej);
      return q;
    },
  },
}));

vi.mock('../src/services/recallService.js', () => ({ finalizeBotRecording: vi.fn() }));

const alerts = await import('../src/lib/alerts.js');
const loops = await import('../src/lib/loopMonitor.js');
const { checkPipelineInvariants, BOT_JOIN_GRACE_MS, BOT_ALERT_MAX_AGE_MS } = await import('../src/services/pipelineInvariants.js');
const { expireStaleBotRuns } = await import('../src/services/stuckMeetingRecovery.js');

beforeEach(() => {
  reportFailure.mockClear(); calls.length = 0; updates.length = 0; data = {};
  alerts.resetAlertThrottle(); loops.resetLoopMonitor();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('BOT_NEVER_JOINED window', () => {
  it('only counts runs between the join grace period and 24 h old (months-old rows are not fresh failures)', async () => {
    const now = Date.parse('2026-11-01T15:00:00Z');
    data = { bot_runs: { data: [], count: 3, error: null } };
    const out = await checkPipelineInvariants(now);
    expect(out.find((o) => o.code === 'BOT_NEVER_JOINED')?.count).toBe(3);
    const bot = calls.filter((c) => c.table === 'bot_runs');
    expect(bot.find((c) => c.op === 'in')!.args).toEqual(['status', ['pending', 'joining']]);
    expect(bot.find((c) => c.op === 'lt')!.args).toEqual(['created_at', new Date(now - BOT_JOIN_GRACE_MS).toISOString()]);
    expect(bot.find((c) => c.op === 'gte')!.args).toEqual(['created_at', new Date(now - BOT_ALERT_MAX_AGE_MS).toISOString()]);
    expect(BOT_JOIN_GRACE_MS).toBe(45 * 60_000);
    expect(BOT_ALERT_MAX_AGE_MS).toBe(24 * 3600_000);
  });
});

describe('expireStaleBotRuns', () => {
  it('does nothing when there are no stale runs', async () => {
    expect(await expireStaleBotRuns()).toBe(0);
    expect(updates).toEqual([]);
  });

  it('marks the run completed when its recording completed, else failed with STATUS_NEVER_REPORTED; never touches meetings/recordings', async () => {
    data = {
      bot_runs: { data: [{ id: 'b1', meeting_id: 'm1' }], error: null },
      'meetings:one': { data: { recording_id: 'r1' }, error: null },
      'recordings:one': { data: { status: 'completed' }, error: null },
    };
    expect(await expireStaleBotRuns()).toBe(1);
    expect(updates).toEqual([{ table: 'bot_runs', patch: { status: 'completed' } }]);

    updates.length = 0;
    data['meetings:one'] = { data: { recording_id: null }, error: null };
    expect(await expireStaleBotRuns()).toBe(1);
    expect(updates).toEqual([{ table: 'bot_runs', patch: { status: 'failed', error_code: 'STATUS_NEVER_REPORTED', error_message: 'No bot status was reported within 24 hours' } }]);
  });

  it('only selects pending/joining runs not updated for 24 h, and the update re-checks status so a late webhook wins', async () => {
    data = { bot_runs: { data: [{ id: 'b1', meeting_id: 'm1' }], error: null } };
    await expireStaleBotRuns();
    const ins = calls.filter((c) => c.table === 'bot_runs' && c.op === 'in');
    expect(ins).toHaveLength(2);
    for (const i of ins) expect(i.args).toEqual(['status', ['pending', 'joining']]);
    expect(calls.find((c) => c.table === 'bot_runs' && c.op === 'lt')!.args[0]).toBe('updated_at');
  });

  it('a scan error is reported as a loop scan failure, not swallowed', async () => {
    data = { bot_runs: { data: null, error: { message: 'x' } } };
    expect(await expireStaleBotRuns()).toBe(0);
    expect(reportFailure).toHaveBeenCalledTimes(1);
  });
});
