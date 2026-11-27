/**
 * Registering the user's own number as a verified outgoing caller ID. The app shows a code; the carrier rings the number
 * and the person types that code on the keypad. Only then can calls show it. The code is never stored or logged here.
 */
import { PhoneError, type PhoneDeps } from './deps.js';
import { parsePhoneNumber, hashNumber, type NumberProblem } from './numbers.js';
import { MAX_VERIFIED_NUMBERS, VERIFICATION_TTL_SECONDS } from './constants.js';
import { carrierCode } from './gateway.js';
import { webhookUrl } from './settings.js';
import type { PhoneRow } from './store.js';

export const NUMBER_PROBLEMS: Record<NumberProblem, [string, string]> = {
  country_code_required: ['PHONE_COUNTRY_CODE_REQUIRED', 'Start the number with + and the country code, for example +1.'],
  invalid_number: ['PHONE_INVALID_NUMBER', 'That is not a complete phone number.'],
  country_not_supported: ['PHONE_COUNTRY_NOT_SUPPORTED', 'Calls work with United States and Canada numbers only.'],
  number_not_allowed: ['PHONE_NUMBER_NOT_ALLOWED', 'Toll-free, premium and special-rate numbers cannot be used.'],
};

const REFUSALS: Record<string, [number, string, string]> = {
  too_soon: [429, 'PHONE_VERIFY_TOO_SOON', 'Wait a minute before asking for another call.'],
  user_limit: [429, 'PHONE_VERIFY_LIMIT', 'You have asked for too many verification calls. Try again tomorrow.'],
  number_limit: [429, 'PHONE_VERIFY_NUMBER_LIMIT', 'This number has had too many verification calls. Try again later.'],
  number_busy: [409, 'PHONE_VERIFY_NUMBER_BUSY', 'A verification call to this number is already under way. Try again in 10 minutes.'],
  service_limit: [429, 'PHONE_VERIFY_UNAVAILABLE', 'Verification calls are not available right now. Try again tomorrow.'],
  budget_used: [429, 'PHONE_BUDGET_USED', 'Phone calls are used up for this month.'],
};

export const verifiedPhones = (rows: PhoneRow[]): PhoneRow[] => rows.filter((r) => r.status === 'verified' && !!r.twilio_caller_id_sid);

/** How the carrier explains a refused verification call. */
function carrierRefusal(code: string): PhoneError {
  if (code === 'twilio_21450') return new PhoneError(409, 'PHONE_NUMBER_IN_USE', 'This number is already registered. Contact support if it is yours.');
  if (code === 'twilio_21421' || code === 'twilio_21211') return new PhoneError(400, 'PHONE_INVALID_NUMBER', 'That number cannot be called. Check it and try again.');
  return new PhoneError(502, 'PHONE_VERIFY_CALL_FAILED', 'The verification call could not be placed. Try again later.');
}

export async function startVerification(d: PhoneDeps, userId: string, rawNumber: unknown): Promise<{ verification_id: string; code: string; expires_in_seconds: number; phone_number: string }> {
  const parsed = parsePhoneNumber(rawNumber);
  if (parsed.ok === false) {
    const [code, message] = NUMBER_PROBLEMS[parsed.reason];
    await d.track('verify_failed', userId, { reason: parsed.reason });
    throw new PhoneError(400, code, message);
  }
  const phone = parsed.e164;
  const country = parsed.country;
  const mine = await d.store.phonesOfUser(userId);
  const verified = verifiedPhones(mine);
  if (verified.some((r) => r.phone_number === phone)) throw new PhoneError(409, 'PHONE_ALREADY_VERIFIED', 'This number is already verified.');
  if (verified.length >= MAX_VERIFIED_NUMBERS) throw new PhoneError(409, 'PHONE_TOO_MANY_NUMBERS', 'Remove a verified number before adding another.');
  const owner = await d.store.verifiedOwner(phone);
  if (owner && owner !== userId) {
    await d.track('verify_failed', userId, { reason: 'number_in_use', country });
    throw new PhoneError(409, 'PHONE_NUMBER_IN_USE', 'This number is already registered. Contact support if it is yours.');
  }

  // The attempt is booked before anything is dialled. A database that cannot answer throws: no call.
  const reserved = await d.store.reserveVerification(userId, hashNumber(phone, d.settings.numberHashKey));
  if (reserved.ok === false) {
    const [status, code, message] = REFUSALS[reserved.reason] ?? REFUSALS.service_limit!;
    await d.track('verify_failed', userId, { reason: reserved.reason, country });
    if (reserved.reason === 'budget_used') { await d.track('cap_hit', userId, { cap: 'verify_budget', country }); d.alert('BUDGET_CAP_HIT', { at: 'verify' }); }
    throw new PhoneError(status, code, message);
  }
  await d.track('verify_started', userId, { country });

  let call: { code: string; callSid: string };
  const rowIdHolder = { id: '' };
  try {
    // A registration nobody here owns (a deleted account) is removed first, so this attempt has to prove itself.
    const stale = await d.gateway.findCallerId(phone);
    if (stale) await d.gateway.deleteCallerId(stale.sid);
    const row = await d.store.savePendingPhone({
      userId, phone, ledgerId: reserved.ledgerId,
      expiresAt: new Date(d.now() + VERIFICATION_TTL_SECONDS * 1000).toISOString(),
    });
    rowIdHolder.id = row.id;
    call = await d.gateway.requestValidation(phone, webhookUrl(d.settings, `caller-id-status?vid=${encodeURIComponent(row.id)}`));
  } catch (e) {
    const code = carrierCode(e);
    await d.store.releaseVerification(reserved.ledgerId).catch(() => d.alert('LEDGER_UNAVAILABLE', { at: 'verify_release' }));
    if (rowIdHolder.id) await d.store.markVerifyFailed(rowIdHolder.id, code).catch(() => undefined);
    await d.track('verify_failed', userId, { reason: code, country });
    d.alert('VERIFY_PROVIDER_ERROR', { code });
    throw carrierRefusal(code);
  }
  // Losing this only loses the match between callback and call; the attempt itself still works.
  await d.store.setValidationCall(rowIdHolder.id, call.callSid).catch(() => d.alert('DB_WRITE_FAILED', { at: 'validation_call' }));
  return { verification_id: rowIdHolder.id, code: call.code, expires_in_seconds: VERIFICATION_TTL_SECONDS, phone_number: phone };
}

async function complete(d: PhoneDeps, row: PhoneRow, callerIdSid: string): Promise<boolean> {
  const done = await d.store.markVerified(row.id, callerIdSid);
  if (done) {
    await d.track('verify_ok', row.user_id, { country: countryOf(row.phone_number) });
    return true;
  }
  // Not pending any more, or somebody else holds the number: never leave a registration without an owner row.
  const owner = await d.store.verifiedOwner(row.phone_number);
  if (!owner) await d.gateway.deleteCallerId(callerIdSid);
  return owner === row.user_id;
}

async function fail(d: PhoneDeps, row: PhoneRow, reason: string): Promise<void> {
  if (await d.store.markVerifyFailed(row.id, reason)) await d.track('verify_failed', row.user_id, { reason, country: countryOf(row.phone_number) });
}

export function countryOf(e164: string): string | undefined {
  const p = parsePhoneNumber(e164);
  return p.ok === true ? p.country : undefined;
}

/** The carrier's signed callback for one attempt. `id` comes from the signed URL. */
export async function handleCallerIdStatus(d: PhoneDeps, id: string, params: Record<string, string>): Promise<void> {
  const row = await d.store.phoneById(id);
  if (!row || row.status !== 'pending') return;
  if (params.CallSid && row.validation_call_sid && params.CallSid !== row.validation_call_sid) return; // an older attempt
  if (params.VerificationStatus !== 'success') { await fail(d, row, 'code_not_entered'); return; }
  const sid = params.OutgoingCallerIdSid || (await d.gateway.findCallerId(row.phone_number))?.sid;
  if (!sid) { d.alert('VERIFY_NO_CALLER_ID'); return; }
  await complete(d, row, sid);
}

const lastLookup = new Map<string, number>();

/** What the app polls. Falls back to asking the carrier in case the callback was lost. */
export async function verificationStatus(d: PhoneDeps, userId: string, id: string): Promise<{ status: PhoneRow['status']; reason: string | null; phone: PhoneRow | null }> {
  let row = await d.store.phoneById(id);
  if (!row || row.user_id !== userId) throw new PhoneError(404, 'PHONE_VERIFICATION_NOT_FOUND', 'Verification not found.');
  if (row.status === 'pending') {
    const expires = Date.parse(row.verification_expires_at ?? '') || 0;
    const started = expires - VERIFICATION_TTL_SECONDS * 1000;
    const now = d.now();
    if (now - started > 30_000 && now - (lastLookup.get(id) ?? 0) > 15_000) {
      lastLookup.set(id, now);
      if (lastLookup.size > 1000) lastLookup.clear();
      try {
        const found = await d.gateway.findCallerId(row.phone_number);
        // Only a registration made during this attempt counts (one attempt per number runs at a time).
        if (found?.createdAt && found.createdAt.getTime() >= started - 5_000 && found.createdAt.getTime() <= expires) await complete(d, row, found.sid);
      } catch (e) { d.alert('VERIFY_PROVIDER_ERROR', { code: carrierCode(e) }); }
    }
    row = (await d.store.phoneById(id))!;
    if (row.status === 'pending' && now > expires) {
      await fail(d, row, 'expired');
      row = (await d.store.phoneById(id))!;
    }
  }
  return { status: row.status, reason: row.status === 'failed' ? row.failure_reason : null, phone: row };
}

export async function removeNumber(d: PhoneDeps, userId: string, id: string): Promise<void> {
  const row = await d.store.phoneById(id);
  if (!row || row.user_id !== userId) throw new PhoneError(404, 'PHONE_NUMBER_NOT_FOUND', 'Number not found.');
  if (row.twilio_caller_id_sid) {
    try { await d.gateway.deleteCallerId(row.twilio_caller_id_sid); }
    catch (e) {
      d.alert('CALLER_ID_DELETE_FAILED', { code: carrierCode(e) });
      throw new PhoneError(502, 'PHONE_REMOVE_FAILED', 'The number could not be removed. Try again.');
    }
  }
  await d.store.deletePhone(id, userId);
  await d.track('number_removed', userId, {});
}
