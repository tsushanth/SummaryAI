import { describe, it, expect, vi, beforeEach } from 'vitest';

let changed: any[] = [];
let earlierCount: Record<string, number> = {};
let scanError: { message: string } | null = null;
const emails: Record<string, string> = {};
const filters: string[] = [];

vi.mock('../src/lib/failureReporter.js', () => ({ reportFailure: vi.fn(), reportBackendError: vi.fn() }));
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      let head = false;
      let userId = '';
      const q: any = {};
      q.select = (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return q; };
      q.or = (f: string) => { filters.push(f); return q; };
      q.eq = (_c: string, v: string) => { userId = v; return q; };
      for (const m of ['gte', 'lt', 'limit']) q[m] = () => q;
      q.then = (res: any, rej: any) => Promise.resolve(
        head ? { count: earlierCount[userId] ?? 0, error: null } : { data: scanError ? null : changed, error: scanError },
      ).then(res, rej);
      return q;
    },
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: emails[id] ?? 'someone@gmail.com' } }, error: null }) } },
  },
}));

const reporter = await import('../src/lib/failureReporter.js');
const alerts = await import('../src/lib/alerts.js');
const { scanFirstRecordingFailures, resetFirstRecordingAlert } = await import('../src/services/firstRecordingAlert.js');
const { EXPECTED_LOOPS } = await import('../src/lib/loopMonitor.js');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', user_id: 'user-0001', status: 'completed', error_code: 'NO_SPEECH', source: 'upload', content_type: 'audio/webm;codecs=opus',
  duration_seconds: 9, file_size_bytes: 1000, created_at: new Date().toISOString(), ...over,
});
const sent = () => vi.mocked(reporter.reportFailure).mock.calls;

beforeEach(() => {
  vi.mocked(reporter.reportFailure).mockClear();
  resetFirstRecordingAlert(); alerts.resetAlertThrottle();
  changed = [row()]; earlierCount = {}; scanError = null; filters.length = 0;
});

describe('first recording failure report', () => {
  it('reports a first recording with no speech once, with the account id and no content', async () => {
    expect(await scanFirstRecordingFailures()).toBe(1);
    expect(await scanFirstRecordingFailures()).toBe(0);
    expect(sent()).toHaveLength(1);
    const [flow, err, context, userRef] = sent()[0] as any[];
    expect(flow).toBe('first_recording_failed');
    expect(err.message).toBe('First recording failed: NO_SPEECH');
    expect(context).toEqual({ code: 'NO_SPEECH', source: 'upload', client: 'web_recorder', seconds: '9', size_bytes: '1000' });
    expect(userRef).toBe('user-0001');
    expect(filters[0]).toBe('status.eq.failed,error_code.eq.NO_SPEECH');
  });

  it('reports a failed first recording and never forwards free text as the code', async () => {
    changed = [row({ status: 'failed', error_code: 'some free text: secret title' })];
    await scanFirstRecordingFailures();
    expect((sent()[0] as any[])[1].message).toBe('First recording failed: UNKNOWN');
  });

  it('stays quiet when the user had an earlier recording', async () => {
    earlierCount = { 'user-0001': 2 };
    expect(await scanFirstRecordingFailures()).toBe(0);
    expect(sent()).toHaveLength(0);
  });

  it('skips test accounts', async () => {
    changed = [row({ id: 'a', user_id: 't1' }), row({ id: 'b', user_id: 't2' })];
    emails.t1 = 'websignup@example.com'; emails.t2 = 'maria.12345@gmail.com';
    expect(await scanFirstRecordingFailures()).toBe(0);
    expect(sent()).toHaveLength(0);
  });

  it('a failed scan raises the loop alert instead of reporting nothing silently', async () => {
    scanError = { message: 'down' };
    expect(await scanFirstRecordingFailures()).toBe(0);
    expect((sent()[0] as any[])[0]).toBe('background_loop_error');
  });

  it('is watched by the loop watchdog', () => {
    expect(EXPECTED_LOOPS).toContain('FirstRecordingAlert');
  });
});
