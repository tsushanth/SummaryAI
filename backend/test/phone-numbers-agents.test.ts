/**
 * Numbers, the Google Play subscription, incoming calls and agents, against fakes (the money and routing rules themselves
 * are tested in phone-sql-numbers.test.ts). Nothing here contacts Twilio, Google, Calldesk or a database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fakeWorld, sign, SETTINGS, USER, OTHER, MY_NUMBER, DEST } from './helpers-phone.js';
import type { NumbersStore, NumberRow, SubscriptionRow, TrialState } from '../src/phone/numbersStore.js';
import type { CalldeskClient } from '../src/phone/calldesk.js';
import type { PlaySubscription } from '../src/phone/provision.js';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const { createPhoneRouter } = await import('../src/routes/phone.js');
const { createPhoneWebhookRouter } = await import('../src/routes/phoneWebhooks.js');
const { createCalldeskWebhookRouter, createPhoneInternalRouter } = await import('../src/routes/phonePartner.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { readPhonePlan, readAgentTrial } = await import('../src/phone/plan.js');
const { maintainNumbers, sha256 } = await import('../src/phone/provision.js');
const { createCalldeskClient, readCalldeskSettings, verifyCalldeskSignature, cleanResult, CalldeskError } = await import('../src/phone/calldesk.js');
const { ownedReferences } = await import('../src/services/accountPurgeAdapters.js');
const { CONSENT_VERSION } = await import('../src/phone/constants.js');

const SECRET = 'w'.repeat(40);
const OUR = '+14154550900';
const CALLER = '+14154550123';
const TOKEN = 'purchase-token-0123456789abcdef';

function extrasWorld(w: ReturnType<typeof fakeWorld>) {
  const numbers: NumberRow[] = [];
  const subs: SubscriptionRow[] = [];
  const routes: { number_id: string; remote: string; user_id: string; phone_id: string }[] = [];
  const asked: string[] = [];
  const results: Record<string, unknown> = {};
  const state = {
    rentRefusal: null as string | null, legRefusal: null as Record<string, string> | null, draftRefusal: null as string | null,
    sessionFails: false, buyFails: false, searchResult: [OUR], purchaseEnabled: true,
    trialOn: false, trialRefusal: null as string | null, draftError: null as unknown, releaseFails: false,
    pending: [] as { id: string; user_id: string; agent_id: string; created_at: string }[],
    play: { subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', startTime: new Date(w.state.now - 86_400_000).toISOString(), acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING', lineItems: [{ productId: 'own_number', expiryTime: new Date(w.state.now + 30 * 86_400_000).toISOString() }] } as PlaySubscription,
  };
  let n = 0;
  const trials = new Map<string, TrialState>();
  const trialOf = () => ({ ends_at: new Date(w.state.now + 14 * 86_400_000).toISOString(), ended_at: null, end_reason: null, running: true, seconds_left: 900, open_call: false });
  const store: NumbersStore = {
    async trialLimits() { return { days: 14, agentMinutes: 15 }; },
    async startTrial(u, hash, dry) {
      asked.push(`start-trial dry=${dry}`);
      if (hash.includes('+')) throw new Error('a number, not its hash');
      if (state.trialRefusal) return { ok: false, reason: state.trialRefusal };
      const t = trials.get(u);
      if (t) return t.running ? { ok: true, already: true } : { ok: false, reason: 'trial_used' };
      if (!dry) trials.set(u, trialOf());
      return { ok: true };
    },
    async cancelTrial(u) { asked.push('cancel-trial'); trials.delete(u); },
    async endTrial(u, reason) {
      const t = trials.get(u);
      if (!t || t.ended_at) return false;
      Object.assign(t, { ended_at: new Date(w.state.now).toISOString(), end_reason: reason, running: false }); asked.push(`end-trial ${reason}`); return true;
    },
    async sweepTrials(off) { asked.push(`sweep ${off}`); return 0; },
    async trialState(u) { const t = trials.get(u); return t ? { ...t, running: !t.ended_at && Date.parse(t.ends_at) > w.state.now } : null; },
    async releaseDraft(id) { asked.push(`release-draft ${id}`); },
    async numberByE164(e) { return numbers.find((x) => x.phone_number === e && x.status === 'active') ?? null; },
    async personalNumber(u) { return numbers.find((x) => x.user_id === u && x.kind === 'personal' && x.status !== 'released') ?? null; },
    async liveNumbers() { return numbers.filter((x) => x.status !== 'released').map((x) => ({ ...x })); },
    async insertNumber(r) {
      if (r.user_id && numbers.some((x) => x.user_id === r.user_id && x.status !== 'released')) return null;
      const row = { id: `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`, phone_number: null, provider_sid: null, agent_id: null, agent_language: null, agent_description: null, created_at: new Date(w.state.now).toISOString(), status: 'buying' as const, ...r };
      numbers.push(row); return { ...row };
    },
    async updateNumber(id, patch) { Object.assign(numbers.find((x) => x.id === id)!, patch); },
    async bookRent(id) { asked.push(`rent ${id}`); return state.rentRefusal ? { ok: false, reason: state.rentRefusal } : { ok: true }; },
    async releaseRent(id) { asked.push(`release-rent ${id}`); },
    async assignRoute(userId, phoneId, remote) {
      const pool = numbers.find((x) => x.kind === 'pool' && x.status === 'active' && !routes.some((r) => r.number_id === x.id && r.remote === remote && r.user_id !== userId));
      if (!pool) return { ok: false, reason: 'no_shared_number' };
      routes.push({ number_id: pool.id, remote, user_id: userId, phone_id: phoneId });
      return { ok: true, phoneNumber: pool.phone_number!, numberId: pool.id };
    },
    async routeFor(id, remote) { return routes.find((r) => r.number_id === id && r.remote === remote) ?? null; },
    async reserveLeg(a) {
      asked.push(`reserve ${a.kind} company=${a.company}`);
      if (state.legRefusal?.[a.kind]) return { ok: false, reason: state.legRefusal[a.kind]! };
      w.ledger.push({ kind: a.kind, call_id: a.callId, user_id: a.userId, state: 'reserved', call_sid: a.callSid, claimed_at: a.callSid ? new Date(w.state.now).toISOString() : null, notice_served_at: null, reserved_seconds: 600, actual_seconds: null, to: a.to, from: a.from });
      return { ok: true, limitSeconds: 600 };
    },
    async settleLeg(id, seconds) {
      const l = w.ledger.find((x) => x.call_id === id && x.state === 'reserved');
      if (!l) return { ok: false, reason: 'not_open' };
      l.state = 'settled'; l.actual_seconds = seconds; asked.push(`settle ${l.kind} ${seconds}`);
      return { ok: true, costMicro: 1, talkSeconds: seconds, overReservation: false };
    },
    async reserveDraft() { asked.push('reserve draft'); return state.draftRefusal ? { ok: false, reason: state.draftRefusal } : { ok: true, ledgerId: 7 }; },
    async subLeft() { return 1800; },
    async subscription(u) { return subs.find((s) => s.user_id === u) ?? null; },
    async subscriptionOwner(h) { return subs.find((s) => s.token_hash === h)?.user_id ?? null; },
    async saveSubscription(row) { const i = subs.findIndex((s) => s.user_id === row.user_id); if (i >= 0) subs[i] = row; else subs.push(row); },
    async subscriptionsToCheck(before) { return subs.filter((s) => s.checked_at < before); },
    async saveAgentResult(id, r) { results[id] = r; Object.assign(w.calls.find((c) => c.id === id)!, { agent_result: r }); },
    async agentCallsWithoutResult() { return state.pending; },
  };
  const calldesk: CalldeskClient = {
    async languages() { return [{ code: 'es', name: 'Spanish', level: 'phone_verified' }]; },
    async agentPrompt() { return 'Take a message.'; },
    async createAgent(a) { if (state.draftError) throw state.draftError; asked.push(`create-agent ${a.language}`); return { agentId: 'agent-1', description: 'Takes a message.', language: a.language, warnings: [] }; },
    async updateAgent(id, a) { asked.push(`update-agent ${id}`); return { agentId: id, description: 'Updated.', language: a.language, warnings: [] }; },
    async deleteAgent(id) { asked.push(`delete-agent ${id}`); },
    async attachNumber(_u, number, id) { asked.push(`attach ${number === OUR} ${id}`); },
    async createSession(a) { if (state.sessionFails) throw new Error('down'); asked.push(`session ${a.maxSeconds}`); return { streamUrl: 'wss://agent.example.test/partner-stream', token: 'one-time-token', maxSeconds: a.maxSeconds }; },
    async result() { return null; },
    async deleteUser() { asked.push('delete-user'); return 'deleted'; },
  };
  Object.assign(w.gateway, {
    async searchNumbers() { return state.searchResult; },
    async buyNumber(number: string, url: string) { if (state.buyFails) throw Object.assign(new Error(number), { code: 21422 }); asked.push(`buy ${url.endsWith('/v1/webhooks/twilio/voice-inbound')}`); return 'PNnew'; },
    async releaseNumber(sid: string) { if (state.releaseFails) throw new Error('carrier down'); asked.push(`release ${sid}`); },
  });
  w.deps.extras = {
    numbers: store, calldesk,
    play: { async get() { return state.play; }, async acknowledge() { asked.push('acknowledge'); } },
    trialOn: () => state.trialOn,
    plan: () => readPhonePlan({ PHONE_PLAN_PRODUCT_ID: 'own_number', PHONE_PURCHASE_ENABLED: state.purchaseEnabled ? '1' : '' }),
  };
  const addNumber = (kind: 'pool' | 'personal', user: string | null, extra: Partial<NumberRow> = {}) => {
    const row = { id: `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`, phone_number: OUR, country: 'US' as const, kind, provider_sid: 'PNx', user_id: user, status: 'active' as const, agent_id: null, agent_language: null, agent_description: null, created_at: new Date(w.state.now).toISOString(), ...extra };
    numbers.push(row); return row;
  };
  const subscribe = (user = USER) => subs.push({ user_id: user, product_id: 'own_number', token_hash: sha256('x' + user), purchase_token: 't', state: 'SUBSCRIPTION_STATE_ACTIVE', period_start: new Date(w.state.now).toISOString(), expires_at: new Date(w.state.now + 86_400_000 * 10).toISOString(), call_seconds: 6000, agent_seconds: 1800, checked_at: new Date(w.state.now).toISOString() });
  const startedTrial = (user = USER, over: Partial<TrialState> = {}) => { const t = { ...trialOf(), ...over }; trials.set(user, t); return t; };
  return { numbers, subs, routes, asked, state, results, addNumber, subscribe, trials, startedTrial };
}

let w: ReturnType<typeof fakeWorld>;
let x: ReturnType<typeof extrasWorld>;
let server: Server;
let base: string;
let user = USER;
let logged: string[] = [];
const env = { ...process.env };

beforeEach(async () => {
  w = fakeWorld(); x = extrasWorld(w); user = USER; logged = [];
  process.env.FEATURE_PHONE_CALLS = '1';
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(' ')); });
  const app = express();
  app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/v1/api/phone', createPhoneRouter(() => w.deps, (req: any, _res: any, next: any) => { req.user = { id: user }; next(); }));
  app.use('/v1/webhooks/twilio', createPhoneWebhookRouter(() => w.deps));
  app.use('/v1/webhooks/calldesk', createCalldeskWebhookRouter(() => w.deps, () => SECRET));
  app.use('/v1/internal/phone', createPhoneInternalRouter(() => w.deps, async () => [{ segment: 'business' }], () => 'internal-secret', async () => [{ step: 'trial_started', users: 1 }]));
  app.use(errorHandler);
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', () => r())));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterEach(() => { server.close(); vi.restoreAllMocks(); process.env = { ...env }; });

const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-mm-sim-country': 'US', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
const hook = async (path: string, params: Record<string, string>) => {
  const r = await fetch(`${base}/webhooks/twilio/${path}`, { method: 'POST', headers: { 'x-twilio-signature': sign(`${SETTINGS.publicBaseUrl}/v1/webhooks/twilio/${path}`, params) }, body: new URLSearchParams(params) });
  return r.text();
};
const inbound = (from = CALLER) => hook('voice-inbound', { To: OUR, From: from, CallSid: 'CAin' });

describe('plan configuration', () => {
  it('purchase is off unless switched on and a product is named; amounts stay bounded', () => {
    expect(readPhonePlan({}).purchaseEnabled).toBe(false);
    expect(readPhonePlan({ PHONE_PURCHASE_ENABLED: '1' }).purchaseEnabled).toBe(false);
    expect(readPhonePlan({ PHONE_PLAN_PRODUCT_ID: 'p' }).purchaseEnabled).toBe(false);
    expect(readPhonePlan({ PHONE_PLAN_PRODUCT_ID: 'p', PHONE_PURCHASE_ENABLED: 'yes' })).toMatchObject({ purchaseEnabled: true, callMinutes: 100, agentMinutes: 30 });
    expect(readPhonePlan({ PHONE_PLAN_CALL_MINUTES: '100000', PHONE_PLAN_AGENT_MINUTES: '-1' })).toMatchObject({ callMinutes: 100, agentMinutes: 30 });
  });
});

describe('subscription and personal number', () => {
  const verify = (body: Record<string, unknown> = {}) => api('POST', '/api/phone/subscription', { purchase_token: TOKEN, product_id: 'own_number', ...body });

  it('nothing can be bought while purchase is off', async () => {
    x.state.purchaseEnabled = false;
    expect((await verify()).body.error.code).toBe('PHONE_PURCHASE_OFF');
    expect((await api('POST', '/api/phone/number', {})).body.error.code).toBe('PHONE_PURCHASE_OFF');
    expect((await api('GET', '/api/phone/plan')).body).toMatchObject({ purchase_enabled: false, product_id: null });
    expect(x.asked).toEqual([]);
  });

  it('counts only what Google confirms, once, for one account', async () => {
    expect((await verify({ product_id: 'other' })).status).toBe(400);
    const play = x.state.play;
    for (const bad of [{ ...play, subscriptionState: 'SUBSCRIPTION_STATE_PENDING' }, { ...play, lineItems: [] },
      { ...play, lineItems: [{ productId: 'own_number', expiryTime: '2020-01-01T00:00:00Z' }] }, { ...play, externalAccountIdentifiers: { obfuscatedExternalAccountId: sha256(OTHER) } }]) {
      x.state.play = bad;
      expect((await verify()).body.error.code).toBe('PHONE_PURCHASE_INVALID');
    }
    expect(x.subs).toEqual([]);
    x.state.play = play;
    expect((await verify()).body).toMatchObject({ call_minutes: 100, agent_minutes: 30 });
    expect(x.asked).toContain('acknowledge');
    const start = x.subs[0]!.period_start;
    w.state.now += 3600_000;
    await verify(); // seeing it again does not restart the included minutes
    expect(x.subs[0]!.period_start).toBe(start);
    expect(w.steps().filter((s) => s === 'purchase_completed')).toHaveLength(1);
    user = OTHER;
    expect((await verify()).body.error.code).toBe('PHONE_PURCHASE_IN_USE');
    expect(JSON.stringify([logged, w.events])).not.toContain(TOKEN);
  });

  it('a renewal starts a new period where the old one ended', async () => {
    await verify();
    const firstEnd = x.subs[0]!.expires_at;
    w.state.now = Date.parse(firstEnd) + 3600_000;
    x.state.play = { ...x.state.play, lineItems: [{ productId: 'own_number', expiryTime: new Date(Date.parse(firstEnd) + 30 * 86_400_000).toISOString() }] };
    x.subs[0]!.checked_at = '2000-01-01T00:00:00Z';
    await maintainNumbers(w.deps, w.deps.extras!);
    expect(x.subs[0]!.period_start).toBe(firstEnd);
  });

  it('buys a number only with a live subscription and a verified phone, booking the month first', async () => {
    expect((await api('POST', '/api/phone/number', {})).body.error.code).toBe('PHONE_SUBSCRIPTION_REQUIRED');
    x.subscribe();
    expect((await api('POST', '/api/phone/number', {})).body.error.code).toBe('PHONE_NOT_VERIFIED');
    w.addVerified();
    const r = await api('POST', '/api/phone/number', { country: 'US' });
    expect(r.body).toMatchObject({ phone_number: OUR, country: 'US' });
    expect(x.asked.map((a) => a.split(' ')[0])).toEqual(['rent', 'buy']);
    expect((await api('POST', '/api/phone/number', {})).body.id).toBe(r.body.id);
    expect(x.asked.filter((a) => a.startsWith('buy'))).toHaveLength(1);
  });

  it('buys nothing when the booking is refused, and unbooks when the purchase fails', async () => {
    x.subscribe(); w.addVerified();
    x.state.rentRefusal = 'budget_used';
    expect((await api('POST', '/api/phone/number', {})).body.error.code).toBe('PHONE_BUDGET_USED');
    expect(x.asked.some((a) => a.startsWith('buy'))).toBe(false);
    x.state.rentRefusal = null; x.state.buyFails = true;
    expect((await api('POST', '/api/phone/number', {})).status).toBe(502);
    expect(x.numbers.every((n) => n.status === 'released')).toBe(true);
    expect(x.asked.some((a) => a.startsWith('release-rent'))).toBe(true);
    expect(JSON.stringify(logged)).not.toContain(OUR.slice(2));
  });

  it('keeps the number for a few days after the paid time, then releases it and the agent, only on fresh information', async () => {
    x.subscribe(); x.addNumber('personal', USER, { agent_id: 'agent-1' });
    w.state.now = Date.parse(x.subs[0]!.expires_at) + 2 * 86_400_000;
    x.subs[0]!.checked_at = new Date(w.state.now).toISOString();
    x.subs[0]!.state = 'SUBSCRIPTION_STATE_ON_HOLD';
    await maintainNumbers(w.deps, w.deps.extras!);
    expect(x.numbers[0]!.status).toBe('active');
    x.subs[0]!.checked_at = '2000-01-01T00:00:00Z';
    w.state.now += 2 * 86_400_000;
    x.state.play = { subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED', lineItems: [{ productId: 'own_number', expiryTime: x.subs[0]!.expires_at }] };
    w.deps.extras!.play.get = async () => { throw new Error('google down'); };
    await maintainNumbers(w.deps, w.deps.extras!);
    expect(x.numbers[0]!.status).toBe('active');
    w.deps.extras!.play.get = async () => x.state.play;
    await maintainNumbers(w.deps, w.deps.extras!);
    expect(x.numbers[0]!.status).toBe('released');
    expect(x.asked).toEqual(expect.arrayContaining(['delete-agent agent-1', 'release PNx']));
  });

  it('only the owner secret adds a shared number', async () => {
    expect((await api('POST', '/internal/phone/shared-number', { country: 'US' })).status).toBe(401);
    expect((await api('GET', '/internal/phone/funnel', undefined, { 'x-internal-secret': 'wrong' })).status).toBe(401);
    expect(x.asked).toEqual([]);
    expect((await api('GET', '/internal/phone/funnel', undefined, { 'x-internal-secret': 'internal-secret' })).body.rows).toHaveLength(1);
    expect((await api('POST', '/internal/phone/shared-number', { country: 'US' }, { 'x-internal-secret': 'internal-secret' })).status).toBe(201);
    expect(x.numbers[0]).toMatchObject({ kind: 'pool', user_id: null, status: 'active' });
  });
});

describe('outgoing calls from our numbers', () => {
  const start = (from_id: string) => api('POST', '/api/phone/calls', { to: DEST, consent_version: CONSENT_VERSION, from_id });

  it('a shared number is shown only after it is tied to this account for that person', async () => {
    w.addVerified();
    expect((await start('shared')).body.error.code).toBe('PHONE_NO_SHARED_NUMBER');
    x.addNumber('pool', null);
    const r = await start('shared');
    expect(r.body).toMatchObject({ from_number: OUR });
    expect(x.routes).toHaveLength(1);
  });

  it('a personal number uses the subscription, not the free minutes', async () => {
    w.addVerified();
    const mine = x.addNumber('personal', USER);
    const r = await start(mine.id);
    expect(r.body).toMatchObject({ from_number: OUR, time_limit_seconds: 600 });
    expect(x.asked).toContain('reserve call company=false');
    user = OTHER;
    w.addVerified(OTHER, '+14164550100');
    expect((await start(mine.id)).body.error.code).toBe('PHONE_NOT_VERIFIED');
  });
});

describe('incoming calls', () => {
  it('rejects strangers on a shared number without answering, booking or dialling', async () => {
    x.addNumber('pool', null);
    w.addVerified();
    expect(await inbound()).toContain('<Reject/>');
    expect(x.asked).toEqual([]);
  });

  it('forwards a return call to the one user who called that person, notice first', async () => {
    const pool = x.addNumber('pool', null);
    const phone = w.addVerified();
    await w.deps.extras!.numbers.assignRoute(USER, phone.id, (await import('../src/phone/numbers.js')).hashNumber(CALLER, SETTINGS.numberHashKey), 'US');
    const xml = await inbound();
    expect(xml).toMatch(/<Say[^>]*>This call is being recorded\.<\/Say><Dial/);
    expect(xml).toContain(`callerId="${pool.phone_number}"`);
    expect(xml).toContain(`>${MY_NUMBER}</Number>`);
    expect(xml).toContain('record="record-from-answer"');
    expect(xml).toContain('timeLimit="590"');
    expect(x.asked).toContain('reserve inbound company=true');
    expect(w.calls[0]).toMatchObject({ direction: 'in', to_number: CALLER });
    expect(await inbound('+14164550199')).toContain('<Reject/>');
  });

  it('forwards on a personal number from the subscription, and rejects when nothing is left', async () => {
    x.addNumber('personal', USER); w.addVerified();
    expect(await inbound()).toContain('<Dial');
    expect(x.asked).toContain('reserve inbound company=false');
    w.ledger.length = 0;
    x.state.legRefusal = { inbound: 'included_used' };
    expect(await inbound()).toContain('<Reject/>');
    expect(w.steps()).toContain('cap_hit');
  });

  it('rejects unlisted caller countries, unknown numbers and accounts without the feature', async () => {
    x.addNumber('personal', USER); w.addVerified();
    expect(await inbound('+18764550100')).toContain('<Reject/>');
    expect(await hook('voice-inbound', { To: '+14154550999', From: CALLER, CallSid: 'CA' })).toContain('<Reject/>');
    w.state.access.clear();
    expect(await inbound()).toContain('<Reject/>');
    expect(x.asked).toEqual([]);
  });

  it('the agent answers: notice, then recording, then the agent', async () => {
    x.addNumber('personal', USER, { agent_id: 'agent-1', agent_language: 'es' }); w.addVerified();
    const xml = await inbound();
    expect(xml).toMatch(/Esta llamada se está grabando\.<\/Say><Say[^>]*>This call is being recorded\.<\/Say><Start><Recording[^>]*\/><\/Start><Connect><Stream url="wss:\/\/agent\.example\.test\/partner-stream"><Parameter name="token" value="one-time-token"\/><\/Stream><\/Connect><Redirect/);
    expect(x.asked).toEqual(['reserve agent company=false', 'session 600']);
    expect(w.ledger[0]!.notice_served_at).toBeTruthy();
    expect(w.calls[0]).toMatchObject({ agent_id: 'agent-1', direction: 'in' });
    w.state.carrierCalls.set('CAin', { sid: 'CAin', status: 'completed', durationSeconds: 75 });
    await hook(`dial-complete?cid=${w.calls[0]!.id}`, { CallSid: 'CAin' });
    await w.runDeferred();
    expect(x.asked).toContain('settle agent 75');
  });

  it('forwards instead when the agent cannot be reached or its time is used up, and books nothing for it', async () => {
    x.addNumber('personal', USER, { agent_id: 'agent-1' }); w.addVerified();
    x.state.sessionFails = true;
    expect(await inbound()).toContain('<Dial');
    expect(x.asked).toEqual(['reserve agent company=false', 'settle agent 0', 'reserve inbound company=false']);
    expect(w.events).toContainEqual(expect.objectContaining({ step: 'agent_failed', props: { reason: 'session_error' } }));
    w.ledger.length = 0; x.state.legRefusal = { agent: 'included_used' };
    expect(await inbound()).toContain('<Dial');
  });
});

describe('agents', () => {
  const put = (body: Record<string, unknown> = {}) => api('PUT', '/api/phone/agent', { prompt: 'Take a message and ask for a call back number.', language: 'es', ...body });

  it('needs a personal number with a live subscription, and books the draft first', async () => {
    expect((await put()).body.error.code).toBe('PHONE_NUMBER_REQUIRED');
    x.subscribe(); x.addNumber('personal', USER);
    expect((await put({ prompt: 'short' })).body.error.code).toBe('PHONE_AGENT_PROMPT_LENGTH');
    x.state.draftRefusal = 'budget_used';
    expect((await put()).body.error.code).toBe('PHONE_BUDGET_USED');
    expect(x.asked.some((a) => a.startsWith('create-agent'))).toBe(false);
    x.state.draftRefusal = null; x.asked.length = 0;
    expect((await put()).body).toMatchObject({ description: 'Takes a message.', language: 'es' });
    expect(x.asked).toEqual(['reserve draft', 'create-agent es', 'attach true agent-1']);
    expect(w.steps().filter((s) => s === 'agent_created')).toHaveLength(1);
    await put();
    expect(x.asked).toContain('update-agent agent-1');
    expect((await api('DELETE', '/api/phone/agent')).status).toBe(200);
    expect(x.numbers[0]!.agent_id).toBeNull();
    expect(JSON.stringify([logged, w.events])).not.toContain('Take a message');
  });

  const result = (callId: string, over: Record<string, unknown> = {}) => ({ event: 'call.completed', data: {
    external_call_id: callId, external_user_id: USER, agent_id: 'agent-1', duration_seconds: 40, ended_reason: 'completed', outcome: 'answered', language: 'en',
    transcript: [{ role: 'agent', text: 'Hello' }, { role: 'caller', text: 'Hi' }], summary: 'A greeting.', analysis: { built_in: {} }, extra: 'dropped', ...over } });
  const deliver = async (body: unknown, secret = SECRET, at = Math.floor(Date.now() / 1000)) => {
    const raw = JSON.stringify(body);
    const r = await fetch(`${base}/webhooks/calldesk`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-calldesk-timestamp': String(at),
      'x-calldesk-signature': `sha256=${createHmac('sha256', secret).update(`${at}.${raw}`).digest('hex')}` } });
    return r.status;
  };

  it('stores a signed result on its own call only, and shows it with the call', async () => {
    x.addNumber('personal', USER, { agent_id: 'agent-1' }); w.addVerified();
    await inbound();
    const id = w.calls[0]!.id;
    expect(await deliver(result(id), 'z'.repeat(40))).toBe(403);
    expect(await deliver(result(id), SECRET, Math.floor(Date.now() / 1000) - 600)).toBe(403);
    expect(await deliver(result(id, { external_user_id: OTHER }))).toBe(204);
    expect(await deliver(result(id, { agent_id: 'agent-2' }))).toBe(204);
    expect(x.results).toEqual({});
    expect(await deliver(result(id))).toBe(204);
    const shown = (await api('GET', `/api/phone/calls/${id}`)).body.call;
    expect(shown).toMatchObject({ direction: 'in', agent: { summary: 'A greeting.', outcome: 'answered', transcript: [{ role: 'agent', text: 'Hello' }, { role: 'caller', text: 'Hi' }] } });
    expect(JSON.stringify(shown)).not.toContain('dropped');
  });

  it('checks signatures strictly', () => {
    const raw = Buffer.from('{}');
    const good = `sha256=${createHmac('sha256', SECRET).update('1800000000.{}').digest('hex')}`;
    expect(verifyCalldeskSignature(SECRET, '1800000000', good, raw, 1_800_000_000_000)).toBe(true);
    expect(verifyCalldeskSignature('', '1800000000', good, raw, 1_800_000_000_000)).toBe(false);
    expect(verifyCalldeskSignature(SECRET, '1800000000', good, undefined, 1_800_000_000_000)).toBe(false);
    expect(verifyCalldeskSignature(SECRET, '1800000000', good, Buffer.from('{ }'), 1_800_000_000_000)).toBe(false);
  });

  it('the partner client needs all settings, sends the key only in the header, and never echoes prompts in errors', async () => {
    expect(readCalldeskSettings({})).toBeNull();
    expect(readCalldeskSettings({ CALLDESK_PARTNER_BASE_URL: 'http://x', CALLDESK_PARTNER_API_KEY: 'k', CALLDESK_PARTNER_WEBHOOK_SECRET: SECRET })).toBeNull();
    const seen: { url: string; init: any }[] = [];
    const client = createCalldeskClient({ baseUrl: 'https://c.test/api', apiKey: 'cdp_key', webhookSecret: SECRET }, (async (url: string, init: any) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ code: 'prompt_not_allowed', error: 'secret prompt text' }), { status: 422 });
    }) as never);
    await expect(client.createAgent({ userId: USER, prompt: 'secret prompt text', language: 'en', idempotencyKey: 'i' })).rejects.toMatchObject({ code: 'prompt_not_allowed', message: 'calldesk 422 prompt_not_allowed' });
    expect(seen[0]!.init.headers).toMatchObject({ Authorization: 'Bearer cdp_key', 'Idempotency-Key': 'i' });
    expect(seen[0]!.url).toBe('https://c.test/api/agents');
  });

  it('account deletion hands back the number and the agent', () => {
    expect(ownedReferences(USER, [{ provider_sid: 'PN1', status: 'active', agent_id: 'a' }, { provider_sid: 'PN0', status: 'released' }])).toEqual(['number:PN1', `agent:${USER}`]);
    expect(ownedReferences(USER, [])).toEqual([]);
  });
});

describe('free trial', () => {
  const get = (body: Record<string, unknown> = { country: 'US', confirm_trial: true }) => api('POST', '/api/phone/number', body);
  const plan = async () => (await api('GET', '/api/phone/plan')).body;
  const status = async () => (await api('GET', '/api/phone/status')).body;
  const maintain = () => maintainNumbers(w.deps, w.deps.extras!);
  const bought = () => x.asked.filter((a) => a.startsWith('buy')).length;
  const trialOn = () => { x.state.trialOn = true; x.state.purchaseEnabled = false; };

  it('is off unless switched on by an explicit yes', async () => {
    expect(readAgentTrial({})).toBe(false);
    expect(readAgentTrial({ PHONE_AGENT_TRIAL: '0' })).toBe(false);
    expect(readAgentTrial({ PHONE_AGENT_TRIAL: 'yes' })).toBe(true);
    x.state.purchaseEnabled = false; w.addVerified();
    expect((await get()).body.error.code).toBe('PHONE_PURCHASE_OFF');
    expect(await plan()).toMatchObject({ trial: null, number: null, purchase_enabled: false, agents_available: false });
    expect((await status()).own_number).toBe(false);
    expect(x.asked).toEqual([]);
  });

  it('is offered by the server, and nothing is bought until the person confirms', async () => {
    trialOn();
    expect((await status()).own_number).toBe(true);
    expect((await plan()).trial).toEqual({ offered: true, days: 14, agent_minutes: 15, active: null, used: false });
    expect((await get()).body.error.code).toBe('PHONE_NOT_VERIFIED');
    w.addVerified();
    expect((await get({ country: 'US' })).body.error.code).toBe('PHONE_TRIAL_CONFIRM_REQUIRED');
    await maintain();
    expect(bought()).toBe(0);
    expect(x.trials.size).toBe(0);
    const r = await get();
    expect(r.body).toMatchObject({ phone_number: OUR });
    expect(x.asked.filter((a) => /^(start-trial|rent|buy)/.test(a)).map((a) => a.split(' ')[0])).toEqual(['start-trial', 'rent', 'buy']);
    expect((await get()).body.id).toBe(r.body.id);
    expect(bought()).toBe(1);
    expect(await plan()).toMatchObject({ agents_available: true, subscription: null, trial: { offered: false, used: false, active: { agent_minutes_left: 15 } } });
    expect(w.steps()).toEqual(expect.arrayContaining(['own_number_added', 'trial_started']));
    expect(w.steps().filter((s) => s === 'trial_started')).toHaveLength(1);
    expect(JSON.stringify([logged, w.events])).not.toContain(OUR.slice(2));
  });

  it('buys nothing when the trial is refused, and a failed purchase does not use it up', async () => {
    trialOn(); w.addVerified();
    for (const [reason, code] of [['trial_full', 'PHONE_TRIAL_FULL'], ['trial_used', 'PHONE_TRIAL_USED'], ['budget_used', 'PHONE_BUDGET_USED']]) {
      x.state.trialRefusal = reason!;
      expect((await get()).body.error.code).toBe(code);
    }
    expect(bought()).toBe(0);
    expect(w.events.filter((e) => e.step === 'trial_refused').map((e) => e.props.reason)).toEqual(['trial_full', 'trial_used', 'budget_used']);
    x.state.trialRefusal = null; x.state.buyFails = true;
    expect((await get()).status).toBe(502);
    expect(x.trials.size).toBe(0);
    expect(w.alerts).toContain('NUMBER_BUY_FAILED');
    expect(w.steps()).toContain('own_number_failed');
    expect(w.steps()).not.toContain('trial_started');
  });

  it('needs the agent service', async () => {
    trialOn(); w.addVerified(); w.deps.extras!.calldesk = null;
    expect((await get()).body.error.code).toBe('PHONE_AGENT_UNAVAILABLE');
    expect(x.trials.size).toBe(0);
    expect((await status()).own_number).toBe(false);
  });

  it('works like a paid number, on company money: agent, forwarding and outgoing calls', async () => {
    trialOn(); w.addVerified();
    const n = x.addNumber('personal', USER); x.startedTrial();
    const put = await api('PUT', '/api/phone/agent', { prompt: 'Take a message and ask for a call back number.', language: 'en' });
    expect(put.status).toBe(200);
    expect((await api('GET', '/api/phone/agent')).body).toMatchObject({ prompt: 'Take a message.', language: 'en' });
    await inbound();
    expect(x.asked).toContain('reserve agent company=true');
    w.ledger.length = 0; x.state.sessionFails = true;
    expect(await inbound()).toContain('<Dial');
    expect(x.asked).toContain('reserve inbound company=true');
    w.ledger.length = 0;
    const out = await api('POST', '/api/phone/calls', { to: DEST, consent_version: CONSENT_VERSION, from_id: n.id });
    expect(out.body).toMatchObject({ from_number: OUR, time_limit_seconds: 1800 });
    expect(x.asked.some((a) => a.startsWith('reserve call'))).toBe(false);
  });

  it('gives back the allowance of an agent change the service refused', async () => {
    trialOn(); w.addVerified(); x.addNumber('personal', USER); x.startedTrial();
    x.state.draftError = new CalldeskError(429, 'limit_drafts');
    expect((await api('PUT', '/api/phone/agent', { prompt: 'Take a message please.' })).body.error.code).toBe('PHONE_AGENT_LIMIT');
    expect(x.asked).toContain('release-draft 7');
    x.asked.length = 0; x.state.draftError = new CalldeskError(502, 'draft_failed');
    await api('PUT', '/api/phone/agent', { prompt: 'Take a message please.' });
    expect(x.asked.some((a) => a.startsWith('release-draft'))).toBe(false);
    expect(w.events.filter((e) => e.step === 'agent_failed').map((e) => e.props.reason)).toEqual(['limit_drafts', 'draft_failed']);
  });

  it('the person ends it: number and agent are released, also with the feature switched off', async () => {
    trialOn(); w.addVerified();
    x.addNumber('personal', USER, { agent_id: 'agent-1' }); const t = x.startedTrial(USER, { open_call: true });
    expect((await api('DELETE', '/api/phone/number')).body.error.code).toBe('PHONE_CALL_IN_PROGRESS');
    t.open_call = false; process.env.FEATURE_PHONE_CALLS = '';
    expect((await api('DELETE', '/api/phone/number')).body).toEqual({ released: true });
    expect(x.asked).toEqual(['end-trial ended_by_user', 'delete-agent agent-1', 'release PNx', 'delete-user']);
    expect(x.numbers[0]!.status).toBe('released');
    expect((await api('DELETE', '/api/phone/number')).status).toBe(404);
    process.env.FEATURE_PHONE_CALLS = '1';
    expect((await plan()).trial).toMatchObject({ offered: false, active: null, used: true });
    expect((await get()).body.error.code).toBe('PHONE_TRIAL_USED');
  });

  it('somebody with a live subscription never starts a trial', async () => {
    x.state.trialOn = true; x.state.purchaseEnabled = false; x.subscribe(); w.addVerified();
    expect((await get()).body.error.code).toBe('PHONE_PURCHASE_OFF');
    expect(x.trials.size).toBe(0);
    expect(bought()).toBe(0);
  });

  it('a paid number cannot be ended this way', async () => {
    trialOn(); x.subscribe(); x.addNumber('personal', USER);
    expect((await api('DELETE', '/api/phone/number')).body.error.code).toBe('PHONE_NUMBER_PAID');
    expect(x.numbers[0]!.status).toBe('active');
  });

  it('keeps the number while the trial runs', async () => {
    trialOn(); x.addNumber('personal', USER); x.startedTrial();
    await maintain();
    expect(x.numbers[0]!.status).toBe('active');
    expect(x.asked.some((a) => a.startsWith('release'))).toBe(false);
  });

  it.each([
    ['expired', () => { w.state.now += 15 * 86_400_000; }],
    ['used_up', () => { x.trials.get(USER)!.seconds_left = 40; }],
    ['switched_off', () => { x.state.trialOn = false; }],
    ['budget', () => { x.state.rentRefusal = 'budget_used'; }],
  ])('releases the number when the trial is over: %s', async (reason, happen) => {
    trialOn(); x.addNumber('personal', USER, { agent_id: 'agent-1' }); x.startedTrial();
    happen();
    await maintain();
    expect(x.asked).toEqual(expect.arrayContaining([`end-trial ${reason}`, 'delete-agent agent-1', 'release PNx', 'delete-user']));
    expect(x.numbers[0]!.status).toBe('released');
    expect(w.events.find((e) => e.step === 'trial_ended')!.props).toMatchObject({ reason });
    expect(w.events.find((e) => e.step === 'own_number_released')!.props).toMatchObject({ reason });
  });

  it('waits for a call under way and for its result before releasing', async () => {
    trialOn(); x.addNumber('personal', USER, { agent_id: 'agent-1' }); const t = x.startedTrial(USER, { seconds_left: 0, open_call: true });
    await maintain();
    t.open_call = false; x.state.pending = [{ id: 'c', user_id: USER, agent_id: 'agent-1', created_at: new Date(w.state.now).toISOString() }];
    await maintain();
    expect(x.numbers[0]!.status).toBe('active');
    x.state.pending = [];
    await maintain();
    expect(x.numbers[0]!.status).toBe('released');
  });

  it('repeats a release that failed, and says so when it stays failed', async () => {
    trialOn(); x.addNumber('personal', USER); x.startedTrial(USER, { seconds_left: 0 });
    x.state.releaseFails = true;
    await maintain();
    expect(w.alerts).toEqual(expect.arrayContaining(['NUMBER_RELEASE_FAILED', 'TRIAL_RELEASE_FAILED']));
    w.state.now += 2 * 3600_000;
    await maintain();
    expect(w.alerts).toContain('TRIAL_RELEASE_OVERDUE');
    x.state.releaseFails = false;
    await maintain();
    expect(x.numbers[0]!.status).toBe('released');
  });

  it('one number that cannot be checked does not stop the others', async () => {
    trialOn(); x.addNumber('personal', USER); x.addNumber('personal', OTHER, { provider_sid: 'PNother' });
    const read = w.deps.extras!.numbers.trialState;
    w.deps.extras!.numbers.trialState = async (u) => { if (u === USER) throw new Error('db'); return read(u); };
    await maintain();
    expect(w.alerts).toContain('NUMBER_MAINTENANCE_FAILED');
    expect(x.numbers[0]!.status).toBe('active');
    expect(x.numbers[1]!.status).toBe('released');
  });

  it('a subscription taken during the trial keeps the number', async () => {
    trialOn(); x.addNumber('personal', USER); x.startedTrial(); x.subscribe();
    await maintain();
    expect(x.asked).toContain('end-trial subscribed');
    expect(x.numbers[0]!.status).toBe('active');
  });

  it('counts every step for the owner, behind the secret', async () => {
    expect((await api('GET', '/internal/phone/steps')).status).toBe(401);
    expect((await api('GET', '/internal/phone/steps', undefined, { 'x-internal-secret': 'internal-secret' })).body.rows).toHaveLength(1);
    for (const step of ['own_number_opened', 'own_number_confirm_shown', 'own_number_confirm_declined', 'agent_form_opened', 'call_result_opened']) {
      expect((await api('POST', '/api/phone/events', { step })).status).toBe(204);
    }
    expect((await api('POST', '/api/phone/events', { step: 'trial_started' })).status).toBe(400);
  });
});

describe('what the agent collected', () => {
  const base_ = { external_call_id: 'c', external_user_id: USER, agent_id: 'a' };

  it('keeps bounded name and value pairs', () => {
    expect(cleanResult({ ...base_, collected: { name: 'Ana', times: 2, extra: { a: 1 }, empty: '', none: null } })!.collected).toEqual({ name: 'Ana', times: '2', extra: '{"a":1}' });
    for (const bad of [null, undefined, 'text', [1], {}]) expect(cleanResult({ ...base_, collected: bad })!.collected).toBeNull();
    const big = cleanResult({ ...base_, collected: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, 'v'.repeat(900)])) })!.collected!;
    expect(Object.keys(big)).toHaveLength(40);
    expect(big.k0).toHaveLength(500);
  });

  it('shows them with the call, and counts a result once without its content', async () => {
    x.addNumber('personal', USER, { agent_id: 'agent-1' }); w.addVerified();
    await inbound();
    const id = w.calls[0]!.id;
    const body = JSON.stringify({ event: 'call.completed', data: { external_call_id: id, external_user_id: USER, agent_id: 'agent-1', duration_seconds: 30,
      transcript: [{ role: 'caller', text: 'It is Ana' }], summary: 'Ana called.', collected: { caller_name: 'Ana Lopez' } } });
    const at = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 2; i++) {
      await fetch(`${base}/webhooks/calldesk`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-calldesk-timestamp': String(at),
        'x-calldesk-signature': `sha256=${createHmac('sha256', SECRET).update(`${at}.${body}`).digest('hex')}` } });
    }
    expect((await api('GET', `/api/phone/calls/${id}`)).body.call.agent.collected).toEqual({ caller_name: 'Ana Lopez' });
    expect(w.events.filter((e) => e.step === 'agent_result')).toEqual([expect.objectContaining({ props: { turns: 1, seconds: 30, fields: 1, summary: true } })]);
    expect(JSON.stringify([logged, w.events])).not.toContain('Ana');
  });
});
