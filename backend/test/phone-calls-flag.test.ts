/**
 * Phone calls are switched off unless FEATURE_PHONE_CALLS is explicitly set. Installed Android versions keep showing the
 * Phone tab, so what they receive matters: the two lists the tab loads stay valid (and empty), everything else is refused
 * with a stable code, and the Twilio webhooks that make Twilio dial a number only say so and hang up.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.NODE_ENV = 'development'; // config rejects 'test'; failureReporter stays disabled in development
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const db = vi.hoisted(() => ({ tables: [] as string[], row: null as Record<string, unknown> | null }));
const auth = vi.hoisted(() => ({ user: undefined as { id: string } | undefined }));

vi.mock('../src/lib/supabase.js', () => {
  const chain: any = {};
  for (const m of ['select', 'eq', 'not', 'is', 'gte', 'order', 'update', 'insert', 'delete']) chain[m] = () => chain;
  chain.single = async () => ({ data: db.row, error: null });
  chain.range = async () => ({ data: [], error: null, count: 0 });
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok);
  return { supabaseAdmin: { from: (t: string) => { db.tables.push(t); return chain; } } };
});
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!auth.user) { res.status(401).json({ error: { code: 'UNAUTHORIZED' } }); return; }
    req.user = auth.user; next();
  },
}));

const { isPhoneCallsEnabled } = await import('../src/config/featureFlags.js');
const { PHONE_CALLS_OFF_MESSAGE } = await import('../src/middleware/phoneCallsGate.js');
const { default: phoneRouter } = await import('../src/routes/phone.js');
const { default: webhooksRouter } = await import('../src/routes/webhooks.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const envBackup = process.env.FEATURE_PHONE_CALLS;
let server: Server;
let base: string;

beforeEach(async () => {
  delete process.env.FEATURE_PHONE_CALLS;
  auth.user = { id: '11111111-1111-4111-8111-111111111111' };
  db.tables = []; db.row = null;
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/v1/api/phone', phoneRouter);
  app.use('/v1/webhooks', webhooksRouter);
  app.use(errorHandler);
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', () => r())));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterEach(() => {
  server.close();
  vi.restoreAllMocks();
  if (envBackup === undefined) delete process.env.FEATURE_PHONE_CALLS; else process.env.FEATURE_PHONE_CALLS = envBackup;
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
});

describe('/api/phone with phone calls off', () => {
  it('the verified numbers list is empty, with the code and message, and reads nothing', async () => {
    const r = await call('GET', '/api/phone/verified');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ phones: [], code: 'FEATURE_DISABLED', message: PHONE_CALLS_OFF_MESSAGE });
    expect(db.tables).toEqual([]);
  });

  it('the call list is an empty page in the shape the app parses', async () => {
    const r = await call('GET', '/api/phone/calls?limit=50&offset=100');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ calls: [], total: 0, limit: 50, offset: 100, code: 'FEATURE_DISABLED', message: PHONE_CALLS_OFF_MESSAGE });
    expect(db.tables).toEqual([]);
  });

  it('a trailing slash behaves the same', async () => {
    expect((await call('GET', '/api/phone/calls/')).status).toBe(200);
    expect((await call('GET', '/api/phone/verified/')).status).toBe(200);
  });

  it.each([
    ['POST', '/api/phone/verify/send', { phone_number: '+15125550100' }],
    ['POST', '/api/phone/verify/check', { phone_number: '+15125550100', code: '123456' }],
    ['DELETE', '/api/phone/verified/abc', undefined],
    ['GET', '/api/phone/voip/token', undefined],
    ['POST', '/api/phone/calls', { from: '+15125550100', to: '+15125550101', server_initiated: true }],
    ['GET', '/api/phone/calls/abc', undefined],
    ['POST', '/api/phone/calls/abc/record', undefined],
    ['DELETE', '/api/phone/calls/abc/record', undefined],
    ['POST', '/api/phone/calls/abc/hangup', undefined],
    ['GET', '/api/phone/anything-new', undefined],
  ])('%s %s is refused with 404 FEATURE_DISABLED and touches nothing', async (method, path, body) => {
    const r = await call(method, path, body);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: { code: 'FEATURE_DISABLED', message: PHONE_CALLS_OFF_MESSAGE } });
    expect(db.tables).toEqual([]);
  });

  it('still requires a signed-in user', async () => {
    auth.user = undefined;
    expect((await call('GET', '/api/phone/calls')).status).toBe(401);
  });
});

describe('/api/phone with phone calls on', () => {
  it('reaches the real routes', async () => {
    process.env.FEATURE_PHONE_CALLS = '1';
    const r = await call('GET', '/api/phone/verified');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ phones: [] });
    expect(db.tables).toEqual(['verified_phones']);
  });
});

const twilio = (path: string, form: Record<string, string> = {}) =>
  fetch(`${base}/webhooks/twilio/${path}`, { method: 'POST', body: new URLSearchParams(form) });

describe('Twilio webhooks with phone calls off', () => {
  it.each([
    ['voip-outbound', { call_id: 'c1', to: '+15125550101', CallSid: 'CA1' }],
    ['caller-connect?call_id=c1&to=%2B15125550101', { CallSid: 'CA1' }],
  ])('%s says calls are unavailable, hangs up and never dials', async (path, form) => {
    db.row = { conference_name: 'phone-call-1', to_number: '+15125550101', from_number: '+15125550100' };
    const r = await twilio(path, form);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/xml');
    const xml = await r.text();
    expect(xml).toContain(`>${PHONE_CALLS_OFF_MESSAGE}</Say>`);
    expect(xml).toContain('<Hangup/>');
    expect(xml).not.toContain('<Dial');
    expect(db.tables).toEqual([]);
  });

  it('a call already dialled can still finish: status and dial callbacks are recorded', async () => {
    expect((await twilio('call-status?call_id=c1', { CallStatus: 'completed' })).status).toBe(200);
    expect((await twilio('dial-complete?call_id=c1', { DialCallStatus: 'completed' })).status).toBe(200);
    expect(db.tables).toEqual(['phone_calls', 'phone_calls']);
  });

  it('a recording that finishes after the switch is still looked up', async () => {
    const r = await twilio('recording-complete?call_id=c1', { RecordingStatus: 'completed', RecordingSid: 'RE1' });
    expect(r.status).toBe(200);
    expect(db.tables).toContain('phone_calls');
  });

  it('a person answering a call already being dialled still hears the recording notice', async () => {
    const xml = await (await twilio('recipient-whisper?call_id=c1')).text();
    expect(xml).toContain('This call is being recorded');
  });
});

describe('Twilio webhooks with phone calls on', () => {
  it('voip-outbound dials again', async () => {
    process.env.FEATURE_PHONE_CALLS = '1';
    db.row = { conference_name: 'phone-call-1', to_number: '+15125550101', from_number: '+15125550100' };
    const xml = await (await twilio('voip-outbound', { call_id: 'c1', CallSid: 'CA1' })).text();
    expect(xml).toContain('<Dial');
    expect(xml).toContain('+15125550101');
  });
});
