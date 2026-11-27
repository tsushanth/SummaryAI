/**
 * Phone calls end to end against fakes: verification, placing a call, the signed carrier webhooks, the recording notice,
 * settlement, the recording becoming a recording of the user, and that no number or code reaches a log.
 * Nothing here contacts Twilio or a database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fakeWorld, sign, SETTINGS, USER, OTHER, MY_NUMBER, DEST, CODE, RE } from './helpers-phone.js';

process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL ??= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dummy';

const { createPhoneRouter } = await import('../src/routes/phone.js');
const { createPhoneWebhookRouter } = await import('../src/routes/phoneWebhooks.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { parsePhoneNumber } = await import('../src/phone/numbers.js');
const { sweepPhoneCalls } = await import('../src/phone/sweeper.js');
const { settleCall } = await import('../src/phone/calls.js');
const { CONSENT_VERSION } = await import('../src/phone/constants.js');
const { readPhoneSettings } = await import('../src/phone/settings.js');
const { carrierReferences } = await import('../src/services/accountPurgeAdapters.js');

let world: ReturnType<typeof fakeWorld>;
let server: Server;
let base: string;
let user = USER;
let logged: string[] = [];
const env = { ...process.env };

beforeEach(async () => {
  world = fakeWorld();
  user = USER;
  logged = [];
  process.env.FEATURE_PHONE_CALLS = '1';
  for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(' ')); });
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/v1/api/phone', createPhoneRouter(() => world.deps, (req: any, _res: any, next: any) => { req.user = { id: user }; next(); }));
  app.use('/v1/webhooks/twilio', createPhoneWebhookRouter(() => world.deps));
  app.use(errorHandler);
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', () => r())));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterEach(() => { server.close(); vi.restoreAllMocks(); process.env = { ...env }; });

/** As the app with a United States SIM sends it; who sees what by country is in phone-availability.test.ts. */
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}/api/phone${path}`, { method, headers: { 'content-type': 'application/json', 'x-mm-sim-country': 'US' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
/** A request exactly as the carrier would sign it (or not). */
const hook = async (path: string, params: Record<string, string>, signature?: string | null) => {
  const sig = signature === undefined ? sign(`${SETTINGS.publicBaseUrl}/v1/webhooks/twilio/${path}`, params) : signature;
  const r = await fetch(`${base}/webhooks/twilio/${path}`, { method: 'POST', headers: sig ? { 'x-twilio-signature': sig } : {}, body: new URLSearchParams(params) });
  return { status: r.status, text: await r.text() };
};
const startCall = (extra: Record<string, unknown> = {}) => api('POST', '/calls', { to: DEST, consent_version: CONSENT_VERSION, ...extra });
const identity = (u = USER) => `client:${u.replace(/-/g, '')}`;
const PARENT = 'CAparent0000000000000000000000001';
/** Reserve, dial and let the called person answer. */
const answeredCall = async () => {
  world.addVerified();
  const { body } = await startCall({ call_language: 'en', output_language: 'fr-CA' });
  await hook('voip-outbound', { From: identity(), CallSid: PARENT, call_id: body.call_id });
  await hook(`callee-notice?cid=${body.call_id}`, { ParentCallSid: PARENT, CallSid: 'CAchild' });
  return body.call_id as string;
};
const finish = (talk: number, app = talk + 20) => {
  world.state.carrierCalls.set(PARENT, { sid: PARENT, status: 'completed', durationSeconds: app });
  world.state.children.set(PARENT, [{ sid: 'CAchild', status: talk ? 'completed' : 'no-answer', durationSeconds: talk }]);
};
const recordingHook = (callId: string, over: Record<string, string> = {}) =>
  hook(`recording-complete?cid=${callId}`, { RecordingSid: RE(1), CallSid: PARENT, RecordingStatus: 'completed', RecordingDuration: '95', ...over });

describe('which numbers are allowed', () => {
  it.each(['+15124550142', '+1 (416) 455-0100', '+18084550100', '+1.604.455.0188'])('allows %s', (n) => {
    expect(parsePhoneNumber(n).ok).toBe(true);
  });
  it.each([
    ['5124550142', 'country_code_required'], ['1 512 555 0142', 'country_code_required'],
    ['+447700900123', 'country_not_supported'], ['+525512345678', 'country_not_supported'],
    ['+18765550100', 'country_not_supported'], // Jamaica
    ['+18095550100', 'country_not_supported'], // Dominican Republic
    ['+17875550100', 'country_not_supported'], // Puerto Rico
    ['+16715550100', 'country_not_supported'], // Guam
    ['+19075550100', 'country_not_supported'], // Alaska, special carrier rate
    ['+18675550100', 'country_not_supported'], // northern Canada, likewise
    ['+19005551234', 'number_not_allowed'], ['+18005551234', 'number_not_allowed'], ['+18885551234', 'number_not_allowed'],
    ['+15005551234', 'number_not_allowed'], ['+15129761234', 'number_not_allowed'], ['+15125551212', 'invalid_number'],
    ['+19115551234', 'number_not_allowed'], ['+15129111234', 'invalid_number'], ['+1512555014', 'invalid_number'],
    ['+15124550142,,123', 'invalid_number'], ['+1512555014x2', 'invalid_number'], ['client:abc', 'invalid_number'], ['', 'invalid_number'],
  ])('refuses %s (%s)', (n, reason) => {
    const r = parsePhoneNumber(n);
    expect(r.ok).toBe(false);
    if (n === '+15125551212') expect(['invalid_number', 'number_not_allowed']).toContain((r as { reason: string }).reason);
    else expect((r as { reason: string }).reason).toBe(reason);
  });
});

describe('who has the feature', () => {
  it('is absent when the switch is off, and the status says so without touching anything', async () => {
    delete process.env.FEATURE_PHONE_CALLS;
    expect((await api('GET', '/status')).body).toEqual({ enabled: false });
    expect((await api('POST', '/verify/start', { phone_number: MY_NUMBER })).status).toBe(404);
    expect((await startCall()).status).toBe(404);
    expect((await api('POST', '/events', { step: 'tab_opened' })).status).toBe(404);
    expect(world.events).toEqual([]);
  });
  it('can be given to listed testers only', async () => {
    delete process.env.FEATURE_PHONE_CALLS;
    process.env.PHONE_CALLS_TESTER_IDS = `x, ${USER}`;
    expect((await api('GET', '/status')).body).toMatchObject({ enabled: true, minutes_left: 30, countries: ['US', 'CA'] });
    user = OTHER;
    expect((await api('GET', '/status')).body).toEqual({ enabled: false });
  });
  it('needs every subaccount setting', () => {
    const full = {
      PHONE_TWILIO_ACCOUNT_SID: 'a', PHONE_TWILIO_AUTH_TOKEN: 'b', PHONE_TWILIO_API_KEY_SID: 'c', PHONE_TWILIO_API_KEY_SECRET: 'd',
      PHONE_TWILIO_TWIML_APP_SID: 'e', PHONE_NUMBER_HASH_KEY: 'f', SERVICE_URL: 'https://x/',
    };
    expect(readPhoneSettings(full)?.publicBaseUrl).toBe('https://x');
    for (const k of Object.keys(full)) expect(readPhoneSettings({ ...full, [k]: '' }), k).toBeNull();
  });
  it('refuses anonymous or blocked accounts', async () => {
    world.state.user = { email: '', isAnonymous: true, banned: false };
    expect((await api('POST', '/verify/start', { phone_number: MY_NUMBER })).body.error.code).toBe('PHONE_ACCOUNT_NOT_ELIGIBLE');
    expect((await startCall()).status).toBe(403);
    expect(world.asked).toEqual([]);
  });
});

describe('verifying a number', () => {
  const start = (n = MY_NUMBER) => api('POST', '/verify/start', { phone_number: n });
  const callback = (id: string, params: Record<string, string>) => hook(`caller-id-status?vid=${id}`, { CallSid: 'CAvalidation', ...params });

  it('shows the code, registers the number when it is typed in, and keeps the code nowhere', async () => {
    const r = await start();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ code: CODE, phone_number: MY_NUMBER });
    expect(world.asked[0]).toContain(`/v1/webhooks/twilio/caller-id-status?vid=${r.body.verification_id}`);
    expect(world.asked[0]).not.toContain('5124550142');
    expect((await api('GET', `/verify/${r.body.verification_id}`)).body.status).toBe('pending');
    expect((await callback(r.body.verification_id, { VerificationStatus: 'success', OutgoingCallerIdSid: 'PN123' })).status).toBe(204);
    const done = await api('GET', `/verify/${r.body.verification_id}`);
    expect(done.body).toMatchObject({ status: 'verified', phone: { phone_number: MY_NUMBER } });
    expect(world.phones[0]!.twilio_caller_id_sid).toBe('PN123');
    expect(world.steps()).toEqual(['verify_started', 'verify_ok']);
    expect(JSON.stringify([world.phones, world.events, logged])).not.toContain(CODE);
    expect(JSON.stringify([world.events, logged])).not.toContain('5124550142');
  });

  it('ignores an unsigned or forged callback', async () => {
    const { body } = await start();
    const params = { CallSid: 'CAvalidation', VerificationStatus: 'success', OutgoingCallerIdSid: 'PNevil' };
    const path = `caller-id-status?vid=${body.verification_id}`;
    expect((await hook(path, params, null)).status).toBe(403);
    expect((await hook(path, params, 'forged')).status).toBe(403);
    expect((await hook(path, params, sign(`${SETTINGS.publicBaseUrl}/v1/webhooks/twilio/${path}`, params, 'wrong-token'))).status).toBe(403);
    expect(world.phones[0]!.status).toBe('pending');
  });

  it('reports a wrong or missed code', async () => {
    const { body } = await start();
    await callback(body.verification_id, { VerificationStatus: 'failed' });
    expect((await api('GET', `/verify/${body.verification_id}`)).body).toMatchObject({ status: 'failed', reason: 'code_not_entered' });
    expect(world.events.at(-1)).toMatchObject({ step: 'verify_failed', props: { reason: 'code_not_entered' } });
  });

  it('ignores a callback of an older attempt', async () => {
    const { body } = await start();
    await hook(`caller-id-status?vid=${body.verification_id}`, { CallSid: 'CAold', VerificationStatus: 'success', OutgoingCallerIdSid: 'PN1' });
    expect(world.phones[0]!.status).toBe('pending');
  });

  it('expires, and recovers a lost callback only for a registration made during the attempt', async () => {
    const { body } = await start();
    world.state.callerIds.set(MY_NUMBER, { sid: 'PNold', createdAt: new Date(world.state.now - 86_400_000) });
    world.state.now += 60_000;
    expect((await api('GET', `/verify/${body.verification_id}`)).body.status).toBe('pending');
    world.state.callerIds.set(MY_NUMBER, { sid: 'PNnew', createdAt: new Date(world.state.now - 5_000) });
    world.state.now += 20_000;
    expect((await api('GET', `/verify/${body.verification_id}`)).body.status).toBe('verified');
    const second = await start('+14164550100');
    world.state.now += 700_000;
    expect((await api('GET', `/verify/${second.body.verification_id}`)).body).toMatchObject({ status: 'failed', reason: 'expired' });
  });

  it('requires the country code and a US or Canada number, before any call or booking', async () => {
    expect((await start('5124550142')).body.error.code).toBe('PHONE_COUNTRY_CODE_REQUIRED');
    expect((await start('+447700900123')).body.error.code).toBe('PHONE_COUNTRY_NOT_SUPPORTED');
    expect((await start('+19005550100')).body.error.code).toBe('PHONE_NUMBER_NOT_ALLOWED');
    expect(world.asked).toEqual([]);
  });

  it.each([['too_soon', 429, 'PHONE_VERIFY_TOO_SOON'], ['number_limit', 429, 'PHONE_VERIFY_NUMBER_LIMIT'], ['number_busy', 409, 'PHONE_VERIFY_NUMBER_BUSY'], ['budget_used', 429, 'PHONE_BUDGET_USED']])(
    'rings nobody when the ledger says %s', async (reason, status, code) => {
      world.state.verifyRefusal = reason as string;
      const r = await start();
      expect([r.status, r.body.error.code]).toEqual([status, code]);
      expect(world.asked).toEqual([]);
      if (reason === 'budget_used') expect(world.alerts).toContain('BUDGET_CAP_HIT');
    });

  it('rings nobody when the ledger cannot be written', async () => {
    world.state.ledgerDown = true;
    expect((await start()).status).toBe(500);
    expect(world.asked).toEqual([]);
  });

  it('books nothing when the carrier refuses, and says why without the number', async () => {
    world.state.validationError = Object.assign(new Error(`The number ${MY_NUMBER} is not valid`), { code: 21421, status: 400 });
    const r = await start();
    expect([r.status, r.body.error.code]).toEqual([400, 'PHONE_INVALID_NUMBER']);
    expect(world.state.released).toHaveLength(1);
    expect(world.phones[0]).toMatchObject({ status: 'failed', failure_reason: 'twilio_21421' });
    expect(JSON.stringify([logged, world.events, r.body])).not.toContain('5124550142');
  });

  it('never hands a number to a second account, and replaces a registration nobody owns', async () => {
    world.addVerified(OTHER);
    expect((await start()).body.error.code).toBe('PHONE_NUMBER_IN_USE');
    expect(world.asked).toEqual([]);
    world.phones.length = 0;
    world.state.callerIds.set(MY_NUMBER, { sid: 'PNorphan', createdAt: new Date(0) });
    expect((await start()).status).toBe(201);
    expect(world.asked[0]).toBe('delete-caller-id PNorphan');
  });

  it('removing a number removes the carrier registration first', async () => {
    const row = world.addVerified();
    world.state.carrierDown = true;
    expect((await api('DELETE', `/verified/${row.id}`)).status).toBe(502);
    expect(world.phones).toHaveLength(1);
    world.state.carrierDown = false;
    user = OTHER;
    expect((await api('DELETE', `/verified/${row.id}`)).status).toBe(404);
    user = USER;
    expect((await api('DELETE', `/verified/${row.id}`)).status).toBe(200);
    expect(world.phones).toHaveLength(0);
    expect(world.asked).toContain(`delete-caller-id ${row.twilio_caller_id_sid}`);
  });
});

describe('placing a call', () => {
  it('needs consent, a verified number and an allowed destination', async () => {
    expect((await api('POST', '/calls', { to: DEST })).body.error.code).toBe('PHONE_CONSENT_REQUIRED');
    expect((await startCall()).body.error.code).toBe('PHONE_NOT_VERIFIED');
    world.addVerified();
    expect((await startCall({ to: '+18765550100' })).body.error.code).toBe('PHONE_COUNTRY_NOT_SUPPORTED');
    expect((await startCall({ to: '4154550177' })).body.error.code).toBe('PHONE_COUNTRY_CODE_REQUIRED');
    expect(world.ledger).toEqual([]);
  });

  it('does not accept a number verified only in the old way', async () => {
    world.addVerified().twilio_caller_id_sid = null;
    expect((await startCall()).body.error.code).toBe('PHONE_NOT_VERIFIED');
  });

  it('does not use another account\'s number', async () => {
    const theirs = world.addVerified(OTHER);
    world.addVerified(USER, '+14164550100');
    expect((await startCall({ from_id: theirs.id })).body.error.code).toBe('PHONE_NOT_VERIFIED');
  });

  it('reserves, then returns a short token and the time limit', async () => {
    world.addVerified();
    const r = await startCall();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ token: `token.${USER.replace(/-/g, '')}.120`, time_limit_seconds: 1800, to_number: DEST, from_number: MY_NUMBER });
    expect(world.calls[0]).toMatchObject({ twilio_account: 'phone', consent_version: CONSENT_VERSION });
  });

  it('makes no call when the ledger cannot be written', async () => {
    world.addVerified();
    world.state.ledgerDown = true;
    const r = await startCall();
    expect(r.status).toBe(500);
    expect(r.body.token).toBeUndefined();
    expect(world.calls).toEqual([]);
    expect(world.alerts).toContain('LEDGER_UNAVAILABLE');
  });

  it.each([['user_minutes_used', 'PHONE_MINUTES_USED'], ['budget_used', 'PHONE_BUDGET_USED'], ['call_in_progress', 'PHONE_CALL_IN_PROGRESS'], ['destination_limit', 'PHONE_DESTINATION_LIMIT']])(
    'refuses on %s and counts cap hits', async (reason, code) => {
      world.addVerified();
      world.state.reserveRefusal = reason as string;
      expect((await startCall()).body.error.code).toBe(code);
      expect(world.steps()).toContain('call_refused');
      expect(world.steps().includes('cap_hit')).toBe(['user_minutes_used', 'budget_used'].includes(reason as string));
    });

  it('dials only what was reserved, with the notice first, a time limit and recording', async () => {
    world.addVerified();
    const { body } = await startCall();
    const r = await hook('voip-outbound', { From: identity(), CallSid: PARENT, call_id: body.call_id, To: '+19005550100', to: '+18765550100' });
    expect(r.text).toContain('>This call is being recorded.</Say><Dial');
    expect(r.text).toContain(`callerId="${MY_NUMBER}"`);
    expect(r.text).toContain('timeLimit="1790"');
    expect(r.text).toContain('record="record-from-answer"');
    expect(r.text).toContain(`callee-notice?cid=${body.call_id}`);
    expect(r.text).toContain(`>${DEST}</Number>`);
    expect(r.text).not.toContain('8765550100');
    expect(r.text).not.toContain('9005550100');
    const again = await hook('voip-outbound', { From: identity(), CallSid: 'CAsecond', call_id: body.call_id });
    expect(again.text).toContain('<Reject/>');
    expect(again.text).not.toContain('<Dial');
  });

  it('speaks the notice in the call language and in English', async () => {
    world.addVerified();
    const { body } = await startCall({ call_language: 'fr' });
    const r = await hook('voip-outbound', { From: identity(), CallSid: PARENT, call_id: body.call_id });
    expect(r.text).toMatch(/Cet appel est enregistré\.<\/Say><Say[^>]*>This call is being recorded\.</);
    const callee = await hook(`callee-notice?cid=${body.call_id}`, { ParentCallSid: PARENT });
    expect(callee.text).toContain('Cet appel est enregistré.');
    expect(callee.text).toContain('This call is being recorded.');
  });

  it('rejects unsigned, forged, foreign or switched-off dial requests', async () => {
    world.addVerified();
    const { body } = await startCall();
    const params = { From: identity(), CallSid: PARENT, call_id: body.call_id };
    expect((await hook('voip-outbound', params, null)).status).toBe(403);
    expect((await hook('voip-outbound', params, 'x')).status).toBe(403);
    for (const bad of [{ ...params, From: identity(OTHER) }, { ...params, From: MY_NUMBER }, { ...params, call_id: 'nonsense' }]) {
      expect((await hook('voip-outbound', bad)).text).toContain('<Reject/>');
    }
    world.state.access.clear();
    expect((await hook('voip-outbound', params)).text).toContain('<Reject/>');
    world.state.access.add(USER);
    world.state.ledgerDown = true;
    expect((await hook('voip-outbound', params)).text).toContain('<Reject/>');
  });

  it('refuses every webhook without a valid signature', async () => {
    for (const path of ['voip-outbound', 'callee-notice?cid=x', 'dial-complete?cid=x', 'call-status', 'recording-complete?cid=x', 'caller-id-status?vid=x', 'usage-alarm']) {
      expect((await hook(path, { CallSid: 'CA1' }, null)).status, path).toBe(403);
    }
    expect(world.state.halted).toBe(false);
  });

  it('hangs up on the called person when it cannot be recorded that they were told', async () => {
    world.addVerified();
    const { body } = await startCall();
    await hook('voip-outbound', { From: identity(), CallSid: PARENT, call_id: body.call_id });
    expect((await hook(`callee-notice?cid=${body.call_id}`, { ParentCallSid: 'CAforeign' })).text).toContain('<Hangup/>');
    world.state.ledgerDown = true;
    const r = await hook(`callee-notice?cid=${body.call_id}`, { ParentCallSid: PARENT });
    expect(r.text).toContain('<Hangup/>');
    expect(r.text).not.toContain('<Say');
  });

  it('hang-up before connecting releases the reservation', async () => {
    world.addVerified();
    const { body } = await startCall();
    expect((await api('POST', `/calls/${body.call_id}/hangup`)).status).toBe(200);
    expect(world.ledger[0]!.state).toBe('released');
    expect(world.calls[0]!.status).toBe('cancelled');
    user = OTHER;
    expect((await api('POST', `/calls/${body.call_id}/hangup`)).status).toBe(404);
    expect((await api('GET', `/calls/${body.call_id}`)).status).toBe(404);
  });
});

describe('after the call', () => {
  it('settles from the carrier records once both legs have ended', async () => {
    const id = await answeredCall();
    world.state.carrierCalls.set(PARENT, { sid: PARENT, status: 'in-progress', durationSeconds: 0 });
    expect(await settleCall(world.deps, id)).toBe('waiting');
    finish(95);
    await hook(`dial-complete?cid=${id}`, { CallSid: PARENT, DialCallStatus: 'completed' });
    await world.runDeferred();
    expect(world.ledger[0]).toMatchObject({ state: 'settled', actual_seconds: 95 });
    expect(world.calls[0]).toMatchObject({ status: 'completed', recording_duration: 95 });
    expect(world.steps()).toEqual(['call_started', 'call_connected', 'call_ended']);
    expect(await settleCall(world.deps, id)).toBe('nothing');
  });

  it('marks an unanswered call', async () => {
    world.addVerified();
    const { body } = await startCall();
    await hook('voip-outbound', { From: identity(), CallSid: PARENT, call_id: body.call_id });
    finish(0, 33);
    await hook('call-status', { CallSid: PARENT, CallStatus: 'completed' });
    await world.runDeferred();
    expect(world.calls[0]!.status).toBe('no_answer');
  });

  it('cuts off a call that outlives its limit, and books everything if the carrier never answers', async () => {
    const id = await answeredCall();
    world.state.carrierCalls.set(PARENT, { sid: PARENT, status: 'in-progress', durationSeconds: 0 });
    world.state.now += (1800 + 121) * 1000;
    await sweepPhoneCalls(world.deps);
    expect(world.asked).toContain(`end ${PARENT}`);
    expect(world.alerts).toContain('CALL_OVERRUN');
    world.state.carrierDown = true;
    expect(await settleCall(world.deps, id)).toBe('waiting');
    world.state.now += 3600 * 1000;
    expect(await settleCall(world.deps, id)).toBe('settled');
    expect(world.ledger[0]!.actual_seconds).toBe(1800);
    expect(world.alerts).toContain('SETTLED_AT_FULL_RESERVATION');
  });

  it('saves the recording as a recording of the user, starts transcription and deletes the carrier copy', async () => {
    const id = await answeredCall();
    expect((await recordingHook(id)).status).toBe(204);
    await world.runDeferred();
    expect(world.recordings).toEqual([expect.objectContaining({
      id, user_id: USER, title: `Call to ${DEST}`, file_path: `${USER}/phone-call-${id}.mp3`, status: 'uploaded', source: 'phone_call',
      recording_type: 'meeting', content_type: 'audio/mpeg', duration_seconds: 95, output_language: 'fr-CA', file_size_bytes: 9,
    })]);
    expect(world.processed).toEqual([id]);
    expect(world.asked).toContain(`delete-recording ${RE(1)}`);
    expect(world.calls[0]!.recording_id).toBe(id);
    await recordingHook(id); // delivered twice
    await world.runDeferred();
    expect(world.recordings).toHaveLength(1);
    expect(world.processed).toHaveLength(1);
    world.recordings[0]!.status = 'completed';
    await sweepPhoneCalls(world.deps);
    await sweepPhoneCalls(world.deps);
    expect(world.steps().filter((s) => s === 'call_transcribed')).toHaveLength(1);
    expect(JSON.stringify([logged, world.events, world.alerts])).not.toMatch(/5124550142|4154550177/);
  });

  it('reports a failed transcription', async () => {
    const id = await answeredCall();
    await recordingHook(id);
    await world.runDeferred();
    Object.assign(world.recordings[0]!, { status: 'failed', error_code: 'PROCESSING_FAILED' });
    await sweepPhoneCalls(world.deps);
    expect(world.steps()).toContain('call_transcribe_failed');
    expect(world.alerts).toContain('CALL_TRANSCRIPT_FAILED');
  });

  it('throws away audio of a call whose notice was never served', async () => {
    world.addVerified();
    const { body } = await startCall();
    await hook('voip-outbound', { From: identity(), CallSid: PARENT, call_id: body.call_id });
    await recordingHook(body.call_id);
    await world.runDeferred();
    expect(world.recordings).toEqual([]);
    expect(world.uploads).toEqual([]);
    expect(world.asked).toContain(`delete-recording ${RE(1)}`);
    expect(world.asked.join()).not.toContain('download');
    expect(world.alerts).toContain('NOTICE_NOT_SERVED');
  });

  it('ignores a recording that belongs to a different call', async () => {
    const id = await answeredCall();
    await recordingHook(id, { CallSid: 'CAother' });
    await world.runDeferred();
    expect(world.recordings).toEqual([]);
    expect(world.asked.join()).not.toContain('download');
  });

  it('keeps the carrier copy when saving fails, and the sweeper saves it later', async () => {
    const id = await answeredCall();
    world.state.downloadFails = true;
    await recordingHook(id);
    await world.runDeferred();
    expect(world.recordings).toEqual([]);
    expect(world.asked.join()).not.toContain('delete-recording');
    expect(world.alerts).toContain('RECORDING_STORE_FAILED');
    world.state.downloadFails = false;
    finish(95);
    world.state.carrierRecordings.set(PARENT, [{ sid: RE(1), status: 'completed', durationSeconds: 95 }]);
    world.state.now += 600_000;
    await sweepPhoneCalls(world.deps);
    expect(world.recordings).toHaveLength(1);
    expect(world.processed).toEqual([id]);
  });

  it('the carrier usage alarm halts calling', async () => {
    expect((await hook('usage-alarm', { UsageTriggerSid: 'UT1' })).status).toBe(204);
    expect(world.state.halted).toBe(true);
    expect((await api('GET', '/status')).body).toMatchObject({ minutes_left: 0, service_available: false });
  });
});

describe('measuring', () => {
  it('accepts only the app\'s own steps and the business question', async () => {
    expect((await api('POST', '/events', { step: 'tab_opened', country: 'ca', test: true, extra: DEST })).status).toBe(204);
    expect((await api('POST', '/events', { step: 'call_connected' })).status).toBe(400);
    expect((await api('POST', '/profile', { business: 'business', business_type: 'health' })).status).toBe(204);
    expect((await api('POST', '/profile', { business: 'skipped', business_type: 'health' })).status).toBe(204);
    expect((await api('POST', '/profile', { business: 'maybe' })).status).toBe(400);
    // The country is the one the server decided by (the headers), whatever the body says.
    expect(world.events.map((e) => e.props)).toEqual([
      { country: 'US', test: true },
      { answer: 'business', business_type: 'health', context: 'number', country: 'US' },
      { answer: 'skipped', business_type: undefined, context: 'number', country: 'US' },
    ]);
    expect((await api('GET', '/status')).body.business_answered).toBe(true);
  });
});

describe('account deletion', () => {
  it('collects what the carrier still holds', () => {
    expect(carrierReferences(
      [
        { recording_sid: 'REold' },
        { twilio_account: 'phone', twilio_call_sid: 'CA1', recording_sid: RE(2) },
        { twilio_account: 'phone', twilio_call_sid: 'CA2', recording_deleted_at: '2026-01-01' },
        { twilio_account: null, recording_sid: null },
      ],
      [{ twilio_caller_id_sid: 'PN9' }, { twilio_caller_id_sid: null }],
    )).toEqual(['REold', 'phonecall:CA1', 'callerid:PN9']);
  });
});
