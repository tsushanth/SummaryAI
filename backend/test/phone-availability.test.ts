/**
 * Who is shown phone calls (phone/availability.ts): countries from server config, the app's SIM, network and region,
 * accounts with a verified number, testers, and what versions that send nothing receive. Counts only who could see it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fakeWorld, MY_NUMBER, USER, OTHER } from './helpers-phone.js';

process.env.NODE_ENV = 'development'; // config rejects 'test'; failureReporter stays disabled in development
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));
vi.mock('../src/middleware/auth.js', () => ({ authenticate: (_q: any, _r: any, next: any) => next() }));

const { phoneCountries, phoneVisibility, readClientCountries } = await import('../src/phone/availability.js');
const { createPhoneRouter } = await import('../src/routes/phone.js');
const { PHONE_CALLS_OFF_CODE, PHONE_CALLS_OFF_MESSAGE } = await import('../src/middleware/phoneCallsGate.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const on = { FEATURE_PHONE_CALLS: '1' };
const never = async () => false;
const verified = async () => true;

describe('the countries in server config', () => {
  it('are the United States and Canada unless set', () => {
    for (const v of [undefined, '', '   ']) expect(phoneCountries({ PHONE_COUNTRIES: v })).toEqual(['US', 'CA']);
  });
  it('are exactly the valid codes when set; nothing valid means no country', () => {
    expect(phoneCountries({ PHONE_COUNTRIES: ' us, ca ,gb' })).toEqual(['US', 'CA', 'GB']);
    expect(phoneCountries({ PHONE_COUNTRIES: 'IE' })).toEqual(['IE']);
    expect(phoneCountries({ PHONE_COUNTRIES: 'US,USA,1,,C' })).toEqual(['US']);
    expect(phoneCountries({ PHONE_COUNTRIES: 'none' })).toEqual([]);
  });
});

describe('what the app sends', () => {
  it('keeps two-letter codes only', () => {
    const h: Record<string, string> = { 'x-mm-sim-country': 'us', 'x-mm-network-country': 'USA', 'x-mm-device-region': '419' };
    expect(readClientCountries((n) => h[n])).toEqual({ sim: 'US', network: undefined, region: undefined });
    expect(readClientCountries(() => undefined)).toEqual({ sim: undefined, network: undefined, region: undefined });
  });
});

describe('who sees phone calls', () => {
  const see = (client: Parameters<typeof phoneVisibility>[1], has = never, env: Record<string, string> = on) => phoneVisibility(USER, client, has, env);

  it('nobody while the account switch is off, whatever the country or number', async () => {
    expect(await see({ sim: 'US' }, verified, {})).toBeNull();
  });
  it('a supported SIM or network country is enough', async () => {
    expect(await see({ sim: 'US' })).toEqual({ via: 'country', country: 'US' });
    expect(await see({ network: 'CA' })).toEqual({ via: 'country', country: 'CA' });
    expect(await see({ sim: 'IN', network: 'US' })).toEqual({ via: 'country', country: 'US' }); // visiting
    expect(await see({ sim: 'CA', network: 'MX' })).toEqual({ via: 'country', country: 'CA' }); // roaming
    expect(await see({ sim: 'IN', network: 'IN' })).toBeNull();
  });
  it('the device region counts only when there is neither a SIM nor a network country', async () => {
    expect(await see({ region: 'US' })).toEqual({ via: 'country', country: 'US' });
    expect(await see({ region: 'DE' })).toBeNull();
    expect(await see({ sim: 'IN', region: 'US' })).toBeNull();
    expect(await see({ network: 'GB', region: 'CA' })).toBeNull();
  });
  it('an account with a verified number keeps it abroad', async () => {
    expect(await see({ sim: 'IN', network: 'IN' }, verified)).toEqual({ via: 'verified', country: 'IN' });
    expect(await see({ region: 'DE' }, verified)).toEqual({ via: 'verified', country: 'DE' });
  });
  it('an app that sends no country sees nothing, verified or not, and the number is not looked up', async () => {
    const has = vi.fn(verified);
    expect(await see({}, has)).toBeNull();
    expect(has).not.toHaveBeenCalled();
  });
  it('the number is looked up only when no country decides', async () => {
    const has = vi.fn(verified);
    await see({ sim: 'US' }, has);
    expect(has).not.toHaveBeenCalled();
  });
  it('testers always see it, also with the switch off, abroad or with no country', async () => {
    const env = { PHONE_CALLS_TESTER_IDS: USER };
    expect(await see({}, never, env)).toEqual({ via: 'tester', country: undefined });
    expect(await see({ sim: 'IN' }, never, env)).toEqual({ via: 'tester', country: 'IN' });
    expect(await phoneVisibility(OTHER, { sim: 'US' }, never, env)).toBeNull();
  });
  it('follows the configured list', async () => {
    expect(await see({ sim: 'GB' }, never, { ...on, PHONE_COUNTRIES: 'GB' })).toEqual({ via: 'country', country: 'GB' });
    expect(await see({ sim: 'US' }, never, { ...on, PHONE_COUNTRIES: 'GB' })).toBeNull();
    expect(await see({ sim: 'US' }, never, { ...on, PHONE_COUNTRIES: 'none' })).toBeNull();
  });
});

describe('/api/phone by country', () => {
  let w: ReturnType<typeof fakeWorld>;
  let server: Server;
  let base: string;
  let user = USER;
  const env = { ...process.env };

  beforeEach(async () => {
    w = fakeWorld(); user = USER;
    process.env.FEATURE_PHONE_CALLS = '1';
    delete process.env.PHONE_CALLS_TESTER_IDS;
    delete process.env.PHONE_COUNTRIES;
    for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {});
    const app = express();
    app.use(express.json());
    app.use('/api/phone', createPhoneRouter(() => w.deps, (req: any, _res: any, next: any) => { req.user = { id: user }; next(); }));
    app.use(errorHandler);
    await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', () => r())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/phone`;
  });
  afterEach(() => { server.close(); vi.restoreAllMocks(); process.env = { ...env }; });

  const api = async (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  const from = (sim?: string, network?: string, region?: string) => ({
    ...(sim ? { 'x-mm-sim-country': sim } : {}), ...(network ? { 'x-mm-network-country': network } : {}), ...(region ? { 'x-mm-device-region': region } : {}),
  });
  const enabled = async (headers: Record<string, string> = {}) => (await api('GET', '/status', headers)).body.enabled;

  /** Every request a released version up to 1.7.13 makes, and every request of the newer ones. */
  const REFUSED: [string, string][] = [
    ['POST', '/verify/send'], ['POST', '/verify/check'], ['GET', '/voip/token'], ['POST', '/calls/abc/record'], ['DELETE', '/calls/abc/record'],
    ['POST', '/verify/start'], ['GET', '/verify/abc'], ['POST', '/calls'], ['GET', '/calls/abc'], ['POST', '/calls/abc/hangup'],
    ['POST', '/events'], ['POST', '/profile'], ['GET', '/plan'], ['GET', '/agent'], ['PUT', '/agent'], ['POST', '/number'], ['POST', '/subscription'],
  ];

  it('versions that send no country get "not available" everywhere, are never told to update and are not counted', async () => {
    const phonesOfUser = vi.spyOn(w.deps.store, 'phonesOfUser');
    w.addVerified();
    expect((await api('GET', '/status')).body).toEqual({ enabled: false });
    expect((await api('GET', '/verified')).body).toEqual({ phones: [], code: PHONE_CALLS_OFF_CODE, message: PHONE_CALLS_OFF_MESSAGE });
    expect((await api('GET', '/calls?limit=50')).body).toEqual({ calls: [], total: 0, limit: 50, offset: 0, code: PHONE_CALLS_OFF_CODE, message: PHONE_CALLS_OFF_MESSAGE });
    for (const [m, p] of REFUSED) {
      const r = await api(m, p, {}, m === 'GET' ? undefined : { phone_number: MY_NUMBER, step: 'tab_opened', business: 'business' });
      expect([r.status, r.body.error.code], `${m} ${p}`).toEqual([404, PHONE_CALLS_OFF_CODE]);
      expect(r.body.error.message, `${m} ${p}`).not.toMatch(/update/i);
    }
    expect(phonesOfUser).not.toHaveBeenCalled();
    expect(w.asked).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it('the old app endpoints never ask anyone to update, a tester included', async () => {
    process.env.PHONE_CALLS_TESTER_IDS = USER;
    for (const [m, p] of REFUSED.slice(0, 5)) {
      const r = await api(m, p);
      expect([r.status, r.body.error.code], `${m} ${p}`).toEqual([404, PHONE_CALLS_OFF_CODE]);
    }
  });

  it('is shown for a supported country and hidden elsewhere, on every route', async () => {
    expect(await enabled(from('US'))).toBe(true);
    expect(await enabled(from(undefined, 'CA'))).toBe(true);
    expect(await enabled(from(undefined, undefined, 'US'))).toBe(true);
    expect(await enabled(from('IN', 'IN', 'US'))).toBe(false);
    expect((await api('POST', '/verify/start', from('IN'), { phone_number: MY_NUMBER })).status).toBe(404);
    expect((await api('POST', '/events', from('IN'), { step: 'tab_opened' })).status).toBe(404);
    expect(w.asked).toEqual([]);
  });

  it('the list changes without an app release', async () => {
    expect(await enabled(from('GB'))).toBe(false);
    process.env.PHONE_COUNTRIES = 'US,CA,GB';
    expect(await enabled(from('GB'))).toBe(true);
  });

  it('does not loosen which numbers can be used', async () => {
    process.env.PHONE_COUNTRIES = 'GB';
    expect((await api('POST', '/verify/start', from('GB'), { phone_number: '+447700900123' })).body.error.code).toBe('PHONE_COUNTRY_NOT_SUPPORTED');
    expect(w.asked).toEqual([]);
  });

  it('an account that verified a number keeps it abroad, until the number is removed', async () => {
    w.addVerified();
    expect(await enabled(from('IN', 'IN'))).toBe(true);
    expect((await api('GET', '/verified', from('IN'))).body.phones).toHaveLength(1);
    user = OTHER;
    expect(await enabled(from('IN', 'IN'))).toBe(false);
  });

  it('a failing number lookup is an error, which keeps what the app last showed, and not "not available"', async () => {
    vi.spyOn(w.deps.store, 'phonesOfUser').mockRejectedValue(new Error('db'));
    expect((await api('GET', '/status', from('IN'))).status).toBe(500);
    expect((await api('GET', '/calls', from('IN'))).status).toBe(500);
  });

  it('counts only who was shown it, once a day per country, with no phone number', async () => {
    await enabled(); await enabled(from('IN'));
    expect(w.events).toEqual([]);
    await enabled(from('US')); await enabled(from('US')); await enabled(from(undefined, 'CA'));
    expect(w.events.map((e) => [e.step, e.props])).toEqual([
      ['feature_seen', { country: 'US', via: 'country' }],
      ['feature_seen', { country: 'CA', via: 'country' }],
    ]);
    w.state.now += 86_400_000;
    await enabled(from('US'));
    expect(w.events).toHaveLength(3);
    w.addVerified();
    await enabled(from('IN'));
    expect(w.events[3]!.props).toEqual({ country: 'IN', via: 'verified' });
    expect(JSON.stringify(w.events)).not.toContain(MY_NUMBER.slice(1));
  });

  it('marks test devices, and app steps carry the country the server decided by', async () => {
    await enabled({ ...from('US'), 'x-mm-test': '1' });
    await api('POST', '/events', { ...from('CA'), 'x-mm-test': '1' }, { step: 'tab_opened', country: 'FR' });
    expect(w.events.map((e) => e.props)).toEqual([{ country: 'US', via: 'country', test: true }, { country: 'CA', test: true }]);
  });
});
