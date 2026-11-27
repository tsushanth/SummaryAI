/**
 * Incoming calls on our numbers.
 *  - Shared number: only a person this user called from it reaches the user (the pair number + caller has one owner);
 *    forwarded to the user's verified phone with the recording notice to both. Anyone else is rejected.
 *  - Personal number: answered by the user's agent when there is one and agent time is left; otherwise forwarded.
 * A rejected call is never answered, so it costs nothing. Anything unexpected rejects.
 */
import { twiml as TwiML } from 'twilio';
import type { PhoneDeps, PhoneExtras } from './deps.js';
import { parsePhoneNumber, hashNumber } from './numbers.js';
import { RING_TIMEOUT_SECONDS, TIME_LIMIT_MARGIN_SECONDS, noticesFor } from './constants.js';
import { webhookUrl } from './settings.js';
import { verifiedPhones } from './verification.js';
import type { NumberRow } from './numbersStore.js';
import { numberFunding } from './provision.js';
import { CalldeskError } from './calldesk.js';

const reject = (): string => {
  const r = new TwiML.VoiceResponse();
  r.reject();
  return r.toString();
};
const say = (r: InstanceType<typeof TwiML.VoiceResponse>, language: unknown) => {
  for (const n of noticesFor(language)) r.say({ voice: n.voice as never, language: n.language as never }, n.text);
};

export async function answerInboundCall(d: PhoneDeps, x: PhoneExtras, params: Record<string, string>): Promise<string> {
  try {
    const to = parsePhoneNumber(params.To);
    const from = parsePhoneNumber(params.From);
    if (to.ok === false || from.ok === false || !params.CallSid) return reject();
    const number = await x.numbers.numberByE164(to.e164);
    if (!number) return reject();
    const remoteHash = hashNumber(from.e164, d.settings.numberHashKey);

    let userId = number.user_id;
    let phoneId: string | null = null;
    if (number.kind === 'pool') {
      const route = await x.numbers.routeFor(number.id, remoteHash);
      if (!route) return reject();
      userId = route.user_id;
      phoneId = route.phone_id;
    }
    if (!userId || !d.hasAccess(userId)) return reject();
    const phones = verifiedPhones(await d.store.phonesOfUser(userId));
    const own = phones.find((p) => p.id === phoneId) ?? (number.kind === 'personal' ? phones[0] : undefined);

    // A shared number and a trial number are company money; a paid number is the subscription's.
    const trial = number.kind === 'personal' && (await numberFunding(d, x, userId)) === 'trial';
    if (number.kind === 'personal' && number.agent_id && x.calldesk) {
      const answered = await withAgent(d, x, number, userId, from.e164, remoteHash, params.CallSid, trial);
      if (answered) return answered;
    }
    if (!own) return reject();
    return forward(d, x, number, userId, own.phone_number, from.e164, remoteHash, params.CallSid, number.kind === 'pool' || trial);
  } catch {
    d.alert('INBOUND_FAILED');
    return reject();
  }
}

async function record(d: PhoneDeps, callId: string, userId: string, ourNumber: string, caller: string, callSid: string, extra: Record<string, unknown>) {
  await d.store.insertCall({
    id: callId, user_id: userId, from_number: ourNumber, to_number: caller, to_name: caller, status: 'ringing', twilio_account: 'phone',
    twilio_call_sid: callSid, direction: 'in', call_language: 'en', ...extra,
  } as Parameters<PhoneDeps['store']['insertCall']>[0]);
}

async function forward(d: PhoneDeps, x: PhoneExtras, number: NumberRow, userId: string, own: string, caller: string, remoteHash: string, callSid: string, company: boolean): Promise<string> {
  const callId = d.newId();
  const reserved = await x.numbers.reserveLeg({
    kind: 'inbound', callId, userId, numberId: number.id, userHash: hashNumber(own, d.settings.numberHashKey), remoteHash,
    from: number.phone_number!, to: own, callSid, company,
  });
  if (reserved.ok === false) {
    await refused(d, userId, reserved.reason);
    return reject();
  }
  await record(d, callId, userId, number.phone_number!, caller, callSid, {});
  await d.track('call_started', userId, { direction: 'in' });
  const r = new TwiML.VoiceResponse();
  say(r, 'en'); // the caller hears the notice before the user's phone rings
  const dial = r.dial({
    callerId: number.phone_number!,
    timeLimit: reserved.limitSeconds - TIME_LIMIT_MARGIN_SECONDS,
    timeout: RING_TIMEOUT_SECONDS,
    action: webhookUrl(d.settings, `dial-complete?cid=${callId}`),
    method: 'POST',
    record: 'record-from-answer',
    recordingStatusCallback: webhookUrl(d.settings, `recording-complete?cid=${callId}`),
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: ['completed'],
  });
  dial.number({ url: webhookUrl(d.settings, `callee-notice?cid=${callId}`), method: 'POST' }, own);
  return r.toString();
}

/** Null when the agent cannot take this call (the caller is then forwarded). */
async function withAgent(d: PhoneDeps, x: PhoneExtras, number: NumberRow, userId: string, caller: string, remoteHash: string, callSid: string, company: boolean): Promise<string | null> {
  const callId = d.newId();
  const reserved = await x.numbers.reserveLeg({
    kind: 'agent', callId, userId, numberId: number.id, userHash: null, remoteHash, from: number.phone_number!, to: caller, callSid, company,
  });
  if (reserved.ok === false) {
    await refused(d, userId, reserved.reason);
    return null;
  }
  const language = number.agent_language ?? 'en';
  let session;
  try {
    session = await x.calldesk!.createSession({ userId, agentId: number.agent_id!, callId, language, maxSeconds: reserved.limitSeconds, remoteNumber: caller });
  } catch (e) {
    await x.numbers.settleLeg(callId, 0, false).catch(() => d.alert('LEDGER_UNAVAILABLE', { at: 'agent_release' }));
    const code = e instanceof CalldeskError ? e.code : 'error';
    d.alert('AGENT_SESSION_FAILED', { code });
    await d.track('agent_failed', userId, { reason: `session_${code}`.slice(0, 40) });
    return null;
  }
  await record(d, callId, userId, number.phone_number!, caller, callSid, { agent_id: number.agent_id, call_language: language });
  // The notice is the first thing in this answer, before the recording starts and before the agent joins.
  if (!(await d.store.noticeServed(callId, callSid))) {
    await x.numbers.settleLeg(callId, 0, false);
    return null;
  }
  await d.track('call_connected', userId, { direction: 'in', agent: true });
  const r = new TwiML.VoiceResponse();
  say(r, language);
  r.start().recording({
    recordingStatusCallback: webhookUrl(d.settings, `recording-complete?cid=${callId}`),
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: ['completed'],
  } as never);
  const stream = r.connect().stream({ url: session.streamUrl });
  stream.parameter({ name: 'token', value: session.token });
  r.redirect({ method: 'POST' }, webhookUrl(d.settings, `dial-complete?cid=${callId}`));
  return r.toString();
}

async function refused(d: PhoneDeps, userId: string, reason: string): Promise<void> {
  await d.track('call_refused', userId, { reason, direction: 'in' });
  if (['user_minutes_used', 'included_used', 'budget_used'].includes(reason)) await d.track('cap_hit', userId, { cap: reason });
  if (reason === 'budget_used') d.alert('BUDGET_CAP_HIT', { at: 'inbound' });
}
