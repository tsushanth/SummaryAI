/**
 * Phone calls are switched off unless FEATURE_PHONE_CALLS (or the tester list) says otherwise. Installed Android versions
 * keep showing the Phone tab, so what they receive matters: the two lists the tab loads stay valid (and empty) and
 * everything else is refused with a stable code. The carrier webhooks require a signature whatever the switch says.
 * The production routers are mounted here, with only the database and sign-in replaced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.NODE_ENV = 'development'; // config rejects 'test'; failureReporter stays disabled in development
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const db = vi.hoisted(() => ({ tables: [] as string[] }));
const auth = vi.hoisted(() => ({ user: undefined as { id: string } | undefined }));

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (t: string) => { db.tables.push(t); throw new Error('no database in this test'); },
    rpc: (f: string) => { db.tables.push(f); throw new Error('no database in this test'); },
  },
}));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!auth.user) { res.status(401).json({ error: { code: 'UNAUTHORIZED' } }); return; }
    req.user = auth.user; next();
  },
}));

const { isPhoneCallsEnabled, isPhoneTester } = await import('../src/config/featureFlags.js');
const { PHONE_CALLS_OFF_MESSAGE } = await import('../src/middleware/phoneCallsGate.js');
const { default: phoneRouter } = await import('../src/routes/phone.js');
const { default: phoneWebhookRouter } = await import('../src/routes/phoneWebhooks.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const env = { ...process.env };
let server: Server;
let base: string;

beforeEach(async () => {
  delete process.env.FEATURE_PHONE_CALLS;
  delete process.env.PHONE_CALLS_TESTER_IDS;
  for (const k of Object.keys(process.env)) if (k.startsWith('PHONE_TWILIO_') || k === 'PHONE_NUMBER_HASH_KEY') delete process.env[k];
  auth.user = { id: '11111111-1111-4111-8111-111111111111' };
  db.tables = [];
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/v1/api/phone', phoneRouter);
  app.use('/v1/webhooks/twilio', phoneWebhookRouter);
  app.use(errorHandler);
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', () => r())));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterEach(() => {
  server.close();
  vi.restoreAllMocks();
  process.env = { ...env };
});

const call = (method: string, path: string, body?: unknown) =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

describe('FEATURE_PHONE_CALLS', () => {
  it('is off when unset or not an explicit yes', () => {
    expect(isPhoneCallsEnabled({})).toBe(false);
    for (const v of ['', ' ', '0', 'false', 'off', 'no', 'enabled', 'FEATURE']) {
      expect(isPhoneCallsEnabled({ FEATURE_PHONE_CALLS: v }), JSON.stringify(v)).toBe(false);
    }
  });
  it('is on only for 1, true, on or yes', () => {
    for (const v of ['1', 'true', 'on', 'yes', ' TRUE ']) {
      expect(isPhoneCallsEnabled({ FEATURE_PHONE_CALLS: v }), JSON.stringify(v)).toBe(true);
    }
  });
  it('the tester list names accounts exactly; empty means nobody', () => {
    expect(isPhoneTester('abc', {})).toBe(false);
    expect(isPhoneTester(undefined, { PHONE_CALLS_TESTER_IDS: ',' })).toBe(false);
    expect(isPhoneTester('ABC', { PHONE_CALLS_TESTER_IDS: 'xyz, abc' })).toBe(true);
    expect(isPhoneTester('ab', { PHONE_CALLS_TESTER_IDS: 'abc' })).toBe(false);
  });
});

describe('/api/phone with phone calls off', () => {
  it('status says it is off', async () => {
    expect(await (await call('GET', '/api/phone/status')).json()).toEqual({ enabled: false });
    expect(db.tables).toEqual([]);
  });

  it('switched on without the calls subaccount settings, nothing works and nothing is read', async () => {
    process.env.FEATURE_PHONE_CALLS = '1';
    process.env.PHONE_TWILIO_ACCOUNT_SID = 'x'; // partly configured: still unusable
    expect(await (await call('GET', '/api/phone/status')).json()).toEqual({ enabled: false });
    expect((await call('GET', '/api/phone/verified')).status).toBe(503);
    expect((await call('POST', '/api/phone/calls', {})).status).toBe(503);
    expect(db.tables).toEqual([]);
  });

  it('still requires a signed-in user', async () => {
    auth.user = undefined;
    expect((await call('GET', '/api/phone/calls')).status).toBe(401);
    expect((await call('GET', '/api/phone/status')).status).toBe(401);
  });
});

const configure = () => Object.assign(process.env, {
  PHONE_TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000', PHONE_TWILIO_AUTH_TOKEN: 't', PHONE_TWILIO_API_KEY_SID: 'SK',
  PHONE_TWILIO_API_KEY_SECRET: 's', PHONE_TWILIO_TWIML_APP_SID: 'AP', PHONE_NUMBER_HASH_KEY: 'k', SERVICE_URL: 'https://api.example.test',
});

describe('/api/phone configured but switched off', () => {
  beforeEach(() => { configure(); });

  it('the lists installed apps load are valid empty pages', async () => {
    for (const p of ['/api/phone/verified', '/api/phone/verified/']) {
      const r = await call('GET', p);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ phones: [], code: 'FEATURE_DISABLED', message: PHONE_CALLS_OFF_MESSAGE });
    }
    const r = await call('GET', '/api/phone/calls?limit=50&offset=100');
    expect(await r.json()).toEqual({ calls: [], total: 0, limit: 50, offset: 100, code: 'FEATURE_DISABLED', message: PHONE_CALLS_OFF_MESSAGE });
    expect(db.tables).toEqual([]);
  });

  it.each([
    ['POST', '/api/phone/verify/start', { phone_number: '+15124550100' }],
    ['POST', '/api/phone/verify/send', { phone_number: '+15124550100' }],
    ['GET', '/api/phone/verify/abc', undefined],
    ['GET', '/api/phone/voip/token', undefined],
    ['POST', '/api/phone/calls', { to: '+15124550101' }],
    ['GET', '/api/phone/calls/abc', undefined],
    ['POST', '/api/phone/calls/abc/hangup', undefined],
    ['POST', '/api/phone/events', { step: 'tab_opened' }],
    ['POST', '/api/phone/profile', { business: 'business' }],
    ['GET', '/api/phone/anything-new', undefined],
  ])('%s %s is refused with 404 FEATURE_DISABLED and touches nothing', async (method, path, body) => {
    const r = await call(method, path, body);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: { code: 'FEATURE_DISABLED', message: PHONE_CALLS_OFF_MESSAGE } });
    expect(db.tables).toEqual([]);
  });
});

describe('carrier webhooks', () => {
  const paths = ['voip-outbound', 'callee-notice?cid=c1', 'dial-complete?cid=c1', 'call-status', 'recording-complete?cid=c1', 'caller-id-status?vid=c1', 'usage-alarm',
    // paths of the earlier version of the feature
    'verification-voice?code=123456', 'caller-connect?call_id=c1&to=%2B15124550101', 'server-call-answer?call_id=c1', 'recipient-whisper?call_id=c1', 'recipient-connected', 'verification-status'];

  it.each([[false], [true]])('refuse everything unsigned (configured: %s) and touch nothing', async (isConfigured) => {
    if (isConfigured) { configure(); process.env.FEATURE_PHONE_CALLS = '1'; }
    for (const path of paths) {
      for (const headers of [{}, { 'x-twilio-signature': 'forged' }]) {
        const r = await fetch(`${base}/webhooks/twilio/${path}`, { method: 'POST', headers, body: new URLSearchParams({ CallSid: 'CA1', call_id: 'c1', RecordingStatus: 'completed' }) });
        expect(r.status, path).toBe(403);
        expect(await r.text()).not.toContain('<Dial');
      }
    }
    expect(db.tables).toEqual([]);
  });
});
