import { describe, it, expect, vi, beforeEach } from 'vitest';

let rows: any[] = [];
let scanError: { message: string } | null = null;
let connected: Record<string, number> = {};
const emails: Record<string, string> = {};
const bounds: Array<[string, string, string]> = [];

vi.mock('../src/lib/failureReporter.js', () => ({ reportFailure: vi.fn(), reportBackendError: vi.fn() }));
vi.mock('../src/config/index.js', () => ({ config: { NODE_ENV: 'test' } }));
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const eq: Record<string, string> = {};
      const q: any = {};
      q.select = () => q;
      q.eq = (c: string, v: string) => { eq[c] = v; return q; };
      q.lte = (c: string, v: string) => { bounds.push(['lte', c, v]); return q; };
      q.gte = (c: string, v: string) => { bounds.push(['gte', c, v]); return q; };
      q.limit = () => q;
      q.delete = () => { throw new Error('the scan must only read'); };
      q.then = (res: any, rej: any) => Promise.resolve(
        table === 'calendar_connections'
          ? { count: connected[`${eq.user_id}:${eq.provider}`] ?? 0, error: null }
          : { data: scanError ? null : rows, error: scanError },
      ).then(res, rej);
      return q;
    },
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: emails[id] ?? 'someone@gmail.com' } }, error: null }) } },
  },
}));

const reporter = await import('../src/lib/failureReporter.js');
const alerts = await import('../src/lib/alerts.js');
const { generateOAuthState } = await import('../src/services/googleCalendarService.js');
const { scanUnfinishedCalendarConnects, resetCalendarConnectAlert, EXPIRY_GRACE_MS, EXPIRED_WINDOW_MS } = await import('../src/services/calendarConnectAlert.js');
const { EXPECTED_LOOPS } = await import('../src/lib/loopMonitor.js');

const row = (over: Record<string, unknown> = {}) => ({
  id: 's1', user_id: 'user-0001', provider: 'google', state: generateOAuthState('user-0001', 'n', 'app'), ...over,
});
const sent = () => vi.mocked(reporter.reportFailure).mock.calls;

beforeEach(() => {
  vi.mocked(reporter.reportFailure).mockClear();
  resetCalendarConnectAlert(); alerts.resetAlertThrottle();
  rows = [row()]; scanError = null; connected = {}; bounds.length = 0;
});

describe('calendar sign-ins that never come back', () => {
  it('reports one once, with the provider, the client and the account id only', async () => {
    expect(await scanUnfinishedCalendarConnects()).toBe(1);
    expect(await scanUnfinishedCalendarConnects()).toBe(0);
    expect(sent()).toHaveLength(1);
    const [flow, err, context, userRef] = sent()[0] as any[];
    expect(flow).toBe('calendar_connect_unfinished');
    expect(err.message).toBe('Calendar sign-in never came back: GOOGLE');
    expect(context).toEqual({ provider: 'google', client: 'app' });
    expect(userRef).toBe('user-0001');
  });

  it('looks only at attempts that expired a short while ago', async () => {
    const now = Date.parse('2027-01-01T12:00:00Z');
    await scanUnfinishedCalendarConnects(now);
    expect(bounds).toEqual([
      ['lte', 'expires_at', new Date(now - EXPIRY_GRACE_MS).toISOString()],
      ['gte', 'expires_at', new Date(now - EXPIRY_GRACE_MS - EXPIRED_WINDOW_MS).toISOString()],
    ]);
  });

  it('an old state with no client still reports', async () => {
    rows = [row({ provider: 'microsoft', state: 'garbage' })];
    await scanUnfinishedCalendarConnects();
    expect((sent()[0] as any[])[2]).toEqual({ provider: 'microsoft', client: 'unknown' });
  });

  it('stays quiet when the user connected that provider after all, but not for the other one', async () => {
    connected = { 'user-0001:google': 1 };
    rows = [row(), row({ id: 's2', provider: 'microsoft' })];
    expect(await scanUnfinishedCalendarConnects()).toBe(1);
    expect((sent()[0] as any[])[2].provider).toBe('microsoft');
  });

  it('skips test accounts', async () => {
    rows = [row({ id: 'a', user_id: 't1' }), row({ id: 'b', user_id: 't2' })];
    emails.t1 = 'check@example.com'; emails.t2 = 'maria.12345@gmail.com';
    expect(await scanUnfinishedCalendarConnects()).toBe(0);
    expect(sent()).toHaveLength(0);
  });

  it('a failed scan raises the loop alert instead of reporting nothing silently', async () => {
    scanError = { message: 'down' };
    expect(await scanUnfinishedCalendarConnects()).toBe(0);
    expect((sent()[0] as any[])[1].message).toContain('CALENDARCONNECTALERT_SCAN_FAILED');
  });

  it('is watched by the loop watchdog', () => {
    expect(EXPECTED_LOOPS).toContain('CalendarConnectAlert');
  });
});
