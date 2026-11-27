/**
 * One call: reserve (server decides who may call whom and for how long), dial (single use, signed carrier webhook),
 * recording notice, settle (real cost from the carrier replaces the reservation).
 */
import { twiml as TwiML } from 'twilio';
import { PhoneError, type PhoneDeps } from './deps.js';
import { parsePhoneNumber, hashNumber } from './numbers.js';
import {
  CONSENT_VERSION, RING_TIMEOUT_SECONDS, TIME_LIMIT_MARGIN_SECONDS, VOICE_TOKEN_TTL_SECONDS, asCallLanguage, noticesFor,
} from './constants.js';
import { carrierCode, type CarrierCall } from './gateway.js';
import { webhookUrl } from './settings.js';
import { NUMBER_PROBLEMS, verifiedPhones } from './verification.js';
import type { LedgerCall } from './store.js';
import { numberFunding } from './provision.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Carrier client identities allow letters, digits and underscore only: the account id without its dashes. */
export const identityFor = (userId: string): string => userId.replace(/-/g, '');
export function userFromIdentity(from: unknown): string | null {
  const m = typeof from === 'string' ? /^client:([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i.exec(from) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}`.toLowerCase() : null;
}

const REFUSALS: Record<string, [number, string, string]> = {
  call_in_progress: [409, 'PHONE_CALL_IN_PROGRESS', 'Another call is still in progress.'],
  user_limit: [429, 'PHONE_CALL_LIMIT', 'You have made too many calls in a short time. Try again later.'],
  destination_limit: [429, 'PHONE_DESTINATION_LIMIT', 'This number has been called too many times today. Try again tomorrow.'],
  service_limit: [429, 'PHONE_CALLS_BUSY', 'Calls are not available right now. Try again later.'],
  user_minutes_used: [429, 'PHONE_MINUTES_USED', 'You have used your call minutes for this month.'],
  budget_used: [429, 'PHONE_BUDGET_USED', 'Phone calls are used up for this month.'],
  included_used: [429, 'PHONE_INCLUDED_USED', 'The included minutes of your subscription are used up.'],
};

export interface StartCallInput {
  to?: unknown;
  from_id?: unknown;
  to_name?: unknown;
  consent_version?: unknown;
  output_language?: unknown;
  call_language?: unknown;
}

export interface StartedCall {
  call_id: string;
  token: string;
  to_number: string;
  from_number: string;
  time_limit_seconds: number;
  minutes_left: number;
}

const cleanName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 100);
  return s || null;
};
const cleanLanguageTag = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(v) && v.length <= 16 ? v : null);

export async function startCall(d: PhoneDeps, userId: string, input: StartCallInput): Promise<StartedCall> {
  const refuse = async (reason: string, error: PhoneError): Promise<never> => {
    await d.track('call_refused', userId, { reason });
    throw error;
  };
  // Older apps send no consent version: they cannot place calls.
  if (input.consent_version !== CONSENT_VERSION) {
    await refuse('no_consent', new PhoneError(400, 'PHONE_CONSENT_REQUIRED', 'Update the app and accept the recording notice to make calls.'));
  }
  const to = parsePhoneNumber(input.to);
  if (to.ok === false) {
    const [code, message] = NUMBER_PROBLEMS[to.reason];
    await refuse(to.reason, new PhoneError(400, code, message));
    throw new Error('unreachable');
  }
  const mine = verifiedPhones(await d.store.phonesOfUser(userId));
  // from_id: one of the verified numbers (default), 'shared' for a shared number, or the id of the personal number.
  const verified = input.from_id === undefined || input.from_id === null || input.from_id === 'shared' ? mine[0] : mine.find((p) => p.id === input.from_id);
  const personal = !verified && d.extras && mine.length ? await d.extras.numbers.personalNumber(userId) : null;
  const usePersonal = !!personal && personal.status === 'active' && personal.id === input.from_id;
  const from = verified ?? (usePersonal ? mine[0] : undefined);
  if (!from) return refuse('no_verified_number', new PhoneError(403, 'PHONE_NOT_VERIFIED', 'Verify your phone number first.'));
  const ownParsed = parsePhoneNumber(from.phone_number);
  if (ownParsed.ok === false) return refuse('from_not_allowed', new PhoneError(403, 'PHONE_NOT_VERIFIED', 'Verify your phone number first.'));
  const destHash = hashNumber(to.e164, d.settings.numberHashKey);
  const fromHash = hashNumber(ownParsed.e164, d.settings.numberHashKey);

  let callerId = ownParsed.e164;
  if (input.from_id === 'shared') {
    // The shared number and the person called are tied to this account, so a return call comes back here.
    const route = d.extras ? await d.extras.numbers.assignRoute(userId, from.id, destHash, ownParsed.country) : null;
    if (!route || route.ok === false) return refuse('no_shared_number', new PhoneError(409, 'PHONE_NO_SHARED_NUMBER', 'No shared number is free for this call. Use your own number.'));
    callerId = route.phoneNumber;
  } else if (usePersonal) callerId = personal!.phone_number!;
  const fromParsed = { e164: callerId, country: ownParsed.country };

  const callId = d.newId();
  // A trial number calls on the free minutes; a paid one on its subscription.
  const paidNumber = usePersonal && (await numberFunding(d, d.extras!, userId)) !== 'trial';
  const reserving = paidNumber
    ? d.extras!.numbers.reserveLeg({ kind: 'call', callId, userId, numberId: personal!.id, userHash: fromHash, remoteHash: destHash, from: callerId, to: to.e164, callSid: null, company: false })
      .then((r) => (r.ok === false ? r : { ...r, minutesLeft: Math.floor(r.limitSeconds / 60) }))
    : d.store.reserveCall({ callId, userId, fromHash, destHash, from: callerId, to: to.e164 });
  const reserved = await reserving.catch((e) => {
    // No ledger, no call.
    d.alert('LEDGER_UNAVAILABLE', { at: 'reserve' });
    throw e;
  });
  if (reserved.ok === false) {
    const [status, code, message] = REFUSALS[reserved.reason] ?? REFUSALS.service_limit!;
    if (reserved.reason === 'user_minutes_used' || reserved.reason === 'budget_used' || reserved.reason === 'included_used') {
      await d.track('cap_hit', userId, { cap: reserved.reason === 'budget_used' ? 'month_budget' : 'user_minutes', country: fromParsed.country });
      if (reserved.reason === 'budget_used') d.alert('BUDGET_CAP_HIT', { at: 'call' });
    }
    return refuse(reserved.reason, new PhoneError(status, code, message));
  }

  try {
    await d.store.insertCall({
      id: callId, user_id: userId, from_number: fromParsed.e164, to_number: to.e164, to_name: cleanName(input.to_name),
      status: 'initiated', twilio_account: 'phone', output_language: cleanLanguageTag(input.output_language),
      call_language: asCallLanguage(input.call_language), consent_version: CONSENT_VERSION,
      started_at: new Date(d.now()).toISOString(),
    } as Parameters<PhoneDeps['store']['insertCall']>[0]);
    const token = d.gateway.accessToken(identityFor(userId), VOICE_TOKEN_TTL_SECONDS);
    await d.track('call_started', userId, { country: fromParsed.country, to_country: to.country, limit_min: reserved.limitSeconds / 60 });
    return {
      call_id: callId, token, to_number: to.e164, from_number: fromParsed.e164,
      time_limit_seconds: reserved.limitSeconds, minutes_left: reserved.minutesLeft,
    };
  } catch (e) {
    await d.store.releaseCall(callId, userId).catch(() => undefined);
    d.alert('CALL_SETUP_FAILED', { at: 'start' });
    throw e;
  }
}

const reject = (): string => {
  const r = new TwiML.VoiceResponse();
  r.reject(); // never answered, so nothing is billed
  return r.toString();
};

const hangUp = (): string => {
  const r = new TwiML.VoiceResponse();
  r.hangup();
  return r.toString();
};

const say = (r: InstanceType<typeof TwiML.VoiceResponse>, language: unknown) => {
  for (const n of noticesFor(language)) r.say({ voice: n.voice as never, language: n.language as never }, n.text);
};

/**
 * The app has connected. Everything dialled comes from the reservation; nothing the app sends besides the call id is used.
 * Anything unexpected rejects the call.
 */
export async function answerAppCall(d: PhoneDeps, params: Record<string, string>): Promise<string> {
  try {
    const userId = userFromIdentity(params.From);
    const callId = params.call_id;
    if (!userId || !isUuid(callId) || !params.CallSid || !d.hasAccess(userId)) return reject();
    const claim = await d.store.claimCall(callId, userId, params.CallSid);
    if (claim.ok === false) {
      await d.track('call_refused', userId, { reason: claim.reason });
      return reject();
    }
    const call = await d.store.getCall(callId);
    if (!call || call.user_id !== userId) return reject();
    await d.store.updateCall(callId, { twilio_call_sid: params.CallSid, status: 'ringing' });

    const r = new TwiML.VoiceResponse();
    say(r, call.call_language); // the app user hears the notice before the number is dialled
    const dial = r.dial({
      callerId: claim.from,
      timeLimit: claim.limitSeconds - TIME_LIMIT_MARGIN_SECONDS,
      timeout: RING_TIMEOUT_SECONDS,
      action: webhookUrl(d.settings, `dial-complete?cid=${callId}`),
      method: 'POST',
      record: 'record-from-answer',
      recordingStatusCallback: webhookUrl(d.settings, `recording-complete?cid=${callId}`),
      recordingStatusCallbackMethod: 'POST',
      recordingStatusCallbackEvent: ['completed'],
    });
    // The called person hears the notice after answering and before being connected.
    dial.number({ url: webhookUrl(d.settings, `callee-notice?cid=${callId}`), method: 'POST' }, claim.to);
    return r.toString();
  } catch {
    d.alert('DIAL_FAILED', { at: 'voip_outbound' });
    return reject();
  }
}

/** Spoken to the called person. If it cannot be recorded that they were told, the call ends here. */
export async function calleeNotice(d: PhoneDeps, callId: string, params: Record<string, string>): Promise<string> {
  try {
    if (!isUuid(callId) || !params.ParentCallSid) return hangUp();
    const call = await d.store.getCall(callId);
    if (!call || !(await d.store.noticeServed(callId, params.ParentCallSid))) {
      d.alert('NOTICE_REFUSED');
      return hangUp();
    }
    await d.store.updateCall(callId, { status: 'recording', answered_at: new Date(d.now()).toISOString() });
    await d.track('call_connected', call.user_id, {});
    const r = new TwiML.VoiceResponse();
    say(r, call.call_language);
    return r.toString();
  } catch {
    d.alert('NOTICE_FAILED');
    return hangUp();
  }
}

const FINAL = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled']);
const CALL_STATUS: Record<string, string> = { busy: 'busy', 'no-answer': 'no_answer', failed: 'failed', canceled: 'cancelled' };
/** After the allowed time plus this, a call still running is cut off. */
export const OVERRUN_GRACE_SECONDS = 120;
/** After this long without an answer from the carrier, the full reservation is booked. */
export const SETTLE_GIVE_UP_SECONDS = 3600;

/** Replaces the reservation with the real cost, from the carrier's own records. Safe to call repeatedly. */
export async function settleCall(d: PhoneDeps, callId: string, ledger?: LedgerCall | null): Promise<'settled' | 'waiting' | 'nothing'> {
  const row = ledger ?? (await d.store.ledgerCall(callId));
  if (!row || row.state !== 'reserved' || !row.claimed_at || !row.call_sid) return 'nothing';
  const age = (d.now() - Date.parse(row.claimed_at)) / 1000;

  let parent: CarrierCall | null = null;
  let children: CarrierCall[] = [];
  let unknown = false;
  try {
    parent = await d.gateway.fetchCall(row.call_sid);
    if (parent) children = await d.gateway.childCalls(row.call_sid);
    if (parent && (!FINAL.has(parent.status) || children.some((c) => !FINAL.has(c.status)))) {
      if (age > row.reserved_seconds + OVERRUN_GRACE_SECONDS) {
        d.alert('CALL_OVERRUN');
        await d.gateway.endCall(row.call_sid);
      }
      if (age <= row.reserved_seconds + SETTLE_GIVE_UP_SECONDS) return 'waiting';
      unknown = true;
    }
    if (!parent) unknown = true;
  } catch (e) {
    d.alert('SETTLE_FAILED', { code: carrierCode(e) });
    if (age <= row.reserved_seconds + SETTLE_GIVE_UP_SECONDS) return 'waiting';
    unknown = true;
  }

  // An incoming call is billed on its own length; a call from the app on both legs.
  const incoming = row.kind === 'inbound' || row.kind === 'agent';
  if (incoming && !d.extras) return 'waiting';
  const talk = row.kind === 'agent' ? parent?.durationSeconds ?? 0 : children.reduce((s, c) => s + c.durationSeconds, 0);
  const result = incoming
    ? await d.extras!.numbers.settleLeg(callId, parent?.durationSeconds ?? 0, unknown)
    : await d.store.settleCall(callId, parent?.durationSeconds ?? 0, talk, unknown);
  if (result.ok === false) return 'nothing';
  if (result.overReservation) d.alert('COST_OVER_RESERVATION');
  if (unknown) d.alert('SETTLED_AT_FULL_RESERVATION');

  const call = await d.store.getCall(callId);
  if (!call) return 'settled';
  const answered = !unknown && talk > 0;
  const status = answered || unknown ? 'completed' : CALL_STATUS[children[0]?.status ?? parent?.status ?? 'failed'] ?? 'no_answer';
  await d.store.updateCall(callId, {
    status, ended_at: new Date(d.now()).toISOString(), is_recording: false,
    ...(answered ? { recording_duration: talk } : {}),
  });
  if (row.user_id) {
    await d.track('call_ended', row.user_id, { result: status, seconds: result.talkSeconds, cost_cents: Math.ceil(result.costMicro / 10_000) });
    if (status === 'failed') d.alert('CALL_FAILED_AT_CARRIER');
  }
  return 'settled';
}

/** The app hangs up, or gives up before connecting. */
export async function hangupCall(d: PhoneDeps, userId: string, callId: string): Promise<void> {
  const call = isUuid(callId) ? await d.store.getCall(callId) : null;
  if (!call || call.user_id !== userId) throw new PhoneError(404, 'PHONE_CALL_NOT_FOUND', 'Call not found.');
  if (await d.store.releaseCall(callId, userId)) {
    // Never connected, so nothing was dialled.
    await d.store.updateCall(callId, { status: 'cancelled', ended_at: new Date(d.now()).toISOString() });
    await d.track('call_ended', userId, { result: 'never_connected' });
    return;
  }
  const ledger = await d.store.ledgerCall(callId);
  if (ledger?.state === 'reserved' && ledger.call_sid) {
    try { await d.gateway.endCall(ledger.call_sid); } catch (e) { d.alert('HANGUP_FAILED', { code: carrierCode(e) }); }
    d.later(8_000, () => settleCall(d, callId));
  }
}
