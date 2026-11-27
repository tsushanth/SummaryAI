import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };
const rpcCalls: unknown[][] = [];
const emails: Record<string, string> = {};
/** Every filter applied to the 24 h recording queries. */
const notFilters: unknown[][] = [];
let windowOwners: string[] = [];

vi.mock('../src/lib/failureReporter.js', () => ({ reportFailure: vi.fn(), reportBackendError: vi.fn() }));
vi.mock('../src/config/index.js', () => ({ config: {} }));
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    rpc: async (...args: unknown[]) => { rpcCalls.push(args); return rpcResult; },
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: emails[id] } }, error: null }) } },
    from: () => {
      let columns = '';
      const q: any = {};
      for (const m of ['in', 'lt', 'gte', 'limit', 'or', 'eq']) q[m] = () => q;
      q.select = (c: string) => { columns = c; return q; };
      q.not = (...a: unknown[]) => { notFilters.push(a); return q; };
      q.then = (res: any, rej: any) => Promise.resolve({
        data: columns === 'user_id' ? windowOwners.map((user_id) => ({ user_id })) : [], count: 0, error: null,
      }).then(res, rej);
      return q;
    },
  },
}));

const { testAccountsAmong, isTestAccount, isAutomatedUserAgent } = await import('../src/services/testTraffic.js');
const { createActivationRouter } = await import('../src/routes/activation.js');
const { validateEvent, createLimiter } = await import('../src/services/activationEvents.js');
const { checkPipelineInvariants } = await import('../src/services/pipelineInvariants.js');

const ANON = 'a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';

beforeEach(() => { rpcResult = { data: [], error: null }; rpcCalls.length = 0; notFilters.length = 0; windowOwners = []; for (const k of Object.keys(emails)) delete emails[k]; });

describe('which accounts are test accounts', () => {
  it('asks the database once for the distinct ids', async () => {
    rpcResult = { data: [{ user_id: 'b', reason: 'owner' }], error: null };
    expect([...(await testAccountsAmong(['a', 'b', 'b', null, undefined]))]).toEqual(['b']);
    expect(rpcCalls).toEqual([['test_accounts_among', { p_users: ['a', 'b'] }]]);
  });
  it('does not call the database for nobody', async () => {
    expect((await testAccountsAmong([])).size).toBe(0);
    expect(rpcCalls).toHaveLength(0);
  });
  it('before the migration, falls back to the automated shapes only', async () => {
    rpcResult = { data: null, error: { code: 'PGRST202' } };
    Object.assign(emails, { a: 'x@example.com', b: 'maria.12345@gmail.com', c: 'runner+mmsynth2026@gmail.com', d: 'maria@gmail.com', e: 'q@cloudtestlabaccounts.com' });
    expect([...(await testAccountsAmong(['a', 'b', 'c', 'd', 'e']))]).toEqual(['a', 'b', 'c', 'e']);
    expect(await isTestAccount('unreadable')).toBe(false);
  });
});

describe('automated callers', () => {
  it('knows headless browsers, crawlers and command-line checks', () => {
    for (const ua of ['Mozilla/5.0 (X11) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'curl/8.7.1', 'python-requests/2.32', 'node']) {
      expect(isAutomatedUserAgent(ua), ua).toBe(true);
    }
  });
  it('leaves people alone, including phones whose name contains "bot", and the app', () => {
    for (const ua of ['Mozilla/5.0 (Linux; Android 12; CUBOT KingKong 7) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'okhttp/4.12.0', '', undefined]) {
      expect(isAutomatedUserAgent(ua), String(ua)).toBe(false);
    }
  });
});

describe('activation events', () => {
  async function send(userAgent: string, body: object) {
    const stored: any[] = [];
    const app = express();
    app.use(express.json());
    app.use(createActivationRouter({ enabled: () => true, insertEvent: async (r) => { stored.push(r); }, resolveUser: async () => null, limiter: createLimiter() }));
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      await fetch(`http://127.0.0.1:${port}/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': userAgent }, body: JSON.stringify(body) });
    } finally { server.close(); }
    return stored[0];
  }
  it('stores an automated browser as test, without storing the user agent', async () => {
    const row = await send('Mozilla/5.0 HeadlessChrome/141.0', { anon_id: ANON, name: 'landed', props: { page: 'landing' } });
    expect(row.props).toEqual({ page: 'landing', test: true, test_reason: 'automated_agent' });
    expect(JSON.stringify(row)).not.toContain('Headless');
  });
  it('does not mark a person', async () => {
    const row = await send('Mozilla/5.0 Chrome/141.0', { anon_id: ANON, name: 'landed' });
    expect(row.props).toEqual({});
  });
  it('keeps the sender\'s test mark even past the property limit', () => {
    const props: Record<string, unknown> = {};
    for (let i = 0; i < 8; i++) props[`k${i}`] = i;
    expect(validateEvent({ anon_id: ANON, name: 'record_clicked', props: { ...props, test: true } }, null)?.props.test).toBe(true);
    expect(validateEvent({ anon_id: ANON, name: 'record_clicked', props: { ...props, test: false } }, null)?.props.test).toBeUndefined();
  });
});

describe('24 h pipeline rates', () => {
  it('leave test accounts out of every count', async () => {
    windowOwners = ['person', 'robot', 'robot'];
    rpcResult = { data: [{ user_id: 'robot', reason: 'play_robot' }], error: null };
    await checkPipelineInvariants();
    expect(notFilters).toHaveLength(4);
    expect(notFilters.every((f) => f[0] === 'user_id' && f[1] === 'in' && f[2] === '(robot)')).toBe(true);
  });
  it('add no filter when nobody in the window is a test account', async () => {
    windowOwners = ['person'];
    await checkPipelineInvariants();
    expect(notFilters).toHaveLength(0);
  });
});
