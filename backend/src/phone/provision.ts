/**
 * Numbers, and what pays for a personal one: a subscription or the free trial. A subscription counts only after Google Play
 * confirms it to the server. A number is bought only when the person asks for it, after its first month is booked in the
 * ledger, and is released when what pays for it ends.
 */
import { createHash } from 'node:crypto';
import { PhoneError, type PhoneDeps, type PhoneExtras } from './deps.js';
import { carrierCode } from './gateway.js';
import { hashNumber, parsePhoneNumber } from './numbers.js';
import { webhookUrl } from './settings.js';
import { verifiedPhones } from './verification.js';
import type { NumberRow, SubscriptionRow, TrialState } from './numbersStore.js';

export interface PlaySubscription {
  subscriptionState?: string;
  startTime?: string;
  acknowledgementState?: string;
  lineItems?: { productId: string; expiryTime?: string }[];
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
}
export interface PlayVerifier {
  get(purchaseToken: string): Promise<PlaySubscription>;
  acknowledge(productId: string, purchaseToken: string): Promise<void>;
}

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const LIVE_STATES = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED']);
const MONTH_MS = 31 * 86_400_000;
/**
 * A personal number is kept this long after the paid time ends (a late renewal or a failed payment can recover it);
 * a released number cannot be got back.
 */
export const NUMBER_GRACE_MS = 3 * 86_400_000;

export const isLive = (s: SubscriptionRow | null, now: number): s is SubscriptionRow => !!s && LIVE_STATES.has(s.state) && Date.parse(s.expires_at) > now;

/** What pays for this account's own number right now: its subscription, the free trial, or nothing. */
export async function numberFunding(d: PhoneDeps, x: PhoneExtras, userId: string): Promise<'subscription' | 'trial' | null> {
  if (isLive(await x.numbers.subscription(userId), d.now())) return 'subscription';
  if (x.trialOn() && (await x.numbers.trialState(userId))?.running) return 'trial';
  return null;
}

export async function verifySubscription(d: PhoneDeps, x: PhoneExtras, userId: string, input: { purchase_token?: unknown; product_id?: unknown }): Promise<SubscriptionRow> {
  const plan = x.plan();
  if (!plan.purchaseEnabled) throw new PhoneError(403, 'PHONE_PURCHASE_OFF', 'Buying a number is not available yet.');
  const token = typeof input.purchase_token === 'string' ? input.purchase_token : '';
  if (input.product_id !== plan.productId || token.length < 20 || token.length > 4096) throw new PhoneError(400, 'PHONE_PURCHASE_INVALID', 'That purchase cannot be used.');
  let info: PlaySubscription;
  try { info = await x.play.get(token); }
  catch (e) {
    d.alert('PLAY_VERIFY_FAILED', { code: carrierCode(e) });
    await d.track('purchase_failed', userId, { reason: 'not_checked' });
    throw new PhoneError(502, 'PHONE_PURCHASE_NOT_CHECKED', 'The purchase could not be checked with Google Play. Try again.');
  }
  const line = info.lineItems?.find((l) => l.productId === plan.productId);
  const expires = Date.parse(line?.expiryTime ?? '');
  const bound = info.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (!line || !LIVE_STATES.has(info.subscriptionState ?? '') || !(expires > d.now()) || (bound && bound !== sha256(userId))) {
    await d.track('purchase_failed', userId, { reason: 'invalid' });
    throw new PhoneError(400, 'PHONE_PURCHASE_INVALID', 'That purchase cannot be used.');
  }
  const hash = sha256(token);
  const owner = await x.numbers.subscriptionOwner(hash);
  if (owner && owner !== userId) throw new PhoneError(409, 'PHONE_PURCHASE_IN_USE', 'That purchase belongs to another account.');
  const before = await x.numbers.subscription(userId);
  const row = subscriptionRow(d, x, userId, token, info, expires, before);
  await x.numbers.saveSubscription(row);
  if (info.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
    await x.play.acknowledge(plan.productId, token).catch(() => d.alert('PLAY_ACKNOWLEDGE_FAILED'));
  }
  if (!before || before.token_hash !== hash) await d.track('purchase_completed', userId, {});
  return row;
}

function subscriptionRow(d: PhoneDeps, x: PhoneExtras, userId: string, token: string, info: PlaySubscription, expires: number, before: SubscriptionRow | null): SubscriptionRow {
  const plan = x.plan();
  // A renewal starts a new period where the old one ended; seeing the same period again must not restart it.
  const previousEnd = before ? Date.parse(before.expires_at) : NaN;
  let start: number;
  if (before && before.token_hash === sha256(token) && expires - previousEnd < 86_400_000) start = Date.parse(before.period_start);
  else if (before && previousEnd < expires && previousEnd > expires - MONTH_MS - 86_400_000) start = previousEnd;
  else start = Math.max(Date.parse(info.startTime ?? '') || 0, expires - MONTH_MS);
  return {
    user_id: userId, product_id: plan.productId, token_hash: sha256(token), purchase_token: token, state: info.subscriptionState!,
    period_start: new Date(Math.min(start, d.now())).toISOString(), expires_at: new Date(expires).toISOString(),
    call_seconds: plan.callMinutes * 60, agent_seconds: plan.agentMinutes * 60, checked_at: new Date(d.now()).toISOString(),
  };
}

/** Books the first month, then buys. Anything that fails leaves no number and no booking. */
async function buy(d: PhoneDeps, x: PhoneExtras, row: NumberRow, areaCode: string | undefined): Promise<NumberRow> {
  const drop = async () => {
    await x.numbers.releaseRent(row.id).catch(() => d.alert('LEDGER_UNAVAILABLE', { at: 'rent_release' }));
    await x.numbers.updateNumber(row.id, { status: 'released', released_at: new Date(d.now()).toISOString() });
  };
  const rent = await x.numbers.bookRent(row.id, true);
  if (rent.ok === false) {
    await drop();
    if (rent.reason === 'budget_used') d.alert('BUDGET_CAP_HIT', { at: 'number' });
    throw new PhoneError(429, rent.reason === 'budget_used' ? 'PHONE_BUDGET_USED' : 'PHONE_NUMBERS_UNAVAILABLE', 'No number can be added right now.');
  }
  try {
    const candidates = (await d.gateway.searchNumbers(row.country, areaCode)).filter((n) => parsePhoneNumber(n).ok);
    if (!candidates.length) throw new PhoneError(409, 'PHONE_NO_NUMBER_FOUND', 'No number is available in that area. Try another area code.');
    const sid = await d.gateway.buyNumber(candidates[0]!, webhookUrl(d.settings, 'voice-inbound'));
    const patch = { status: 'active' as const, phone_number: candidates[0]!, provider_sid: sid };
    try { await x.numbers.updateNumber(row.id, patch); }
    catch (e) { await d.gateway.releaseNumber(sid).catch(() => d.alert('NUMBER_ORPHANED')); throw e; }
    return { ...row, ...patch };
  } catch (e) {
    await drop();
    if (e instanceof PhoneError) throw e;
    d.alert('NUMBER_BUY_FAILED', { code: carrierCode(e) });
    throw new PhoneError(502, 'PHONE_NUMBERS_UNAVAILABLE', 'The number could not be set up. Try again.');
  }
}

const TRIAL_REFUSALS: Record<string, [number, string, string]> = {
  trial_used: [403, 'PHONE_TRIAL_USED', 'The free trial has already been used.'],
  trial_full: [429, 'PHONE_TRIAL_FULL', 'No free trial is available right now.'],
  budget_used: [429, 'PHONE_BUDGET_USED', 'Phone calls are used up for this month.'],
};

/**
 * Buys the person's own number, only when they ask: paid by a live subscription, or by the free trial once they have
 * confirmed it (confirm_trial). A purchase that fails uses up neither.
 */
export async function provisionPersonalNumber(d: PhoneDeps, x: PhoneExtras, userId: string, input: { country?: unknown; area_code?: unknown; confirm_trial?: unknown }): Promise<NumberRow> {
  const plan = x.plan();
  const live = isLive(await x.numbers.subscription(userId), d.now());
  const paid = plan.purchaseEnabled && live;
  // Somebody with a live subscription never starts a trial.
  const trial = !live && x.trialOn();
  if (!paid) {
    if (!trial && !plan.purchaseEnabled) throw new PhoneError(403, 'PHONE_PURCHASE_OFF', 'Buying a number is not available yet.');
    if (!trial) throw new PhoneError(403, 'PHONE_SUBSCRIPTION_REQUIRED', 'A subscription is needed for your own number.');
    if (input.confirm_trial !== true) {
      if (plan.purchaseEnabled) throw new PhoneError(403, 'PHONE_SUBSCRIPTION_REQUIRED', 'A subscription is needed for your own number.');
      throw new PhoneError(400, 'PHONE_TRIAL_CONFIRM_REQUIRED', 'Confirm the free trial to get a number.');
    }
  }
  const mine = verifiedPhones(await d.store.phonesOfUser(userId));
  if (!mine.length) throw new PhoneError(403, 'PHONE_NOT_VERIFIED', 'Verify your phone number first.');
  const existing = await x.numbers.personalNumber(userId);
  if (existing?.status === 'active') return existing;
  if (existing) throw new PhoneError(409, 'PHONE_NUMBER_PENDING', 'Your number is already being set up.');
  let newTrial = false;
  if (trial) {
    // A trial is of the agent: without the agent service there is nothing to try.
    if (!x.calldesk) throw new PhoneError(503, 'PHONE_AGENT_UNAVAILABLE', 'Agents are not available right now.');
    const started = await x.numbers.startTrial(userId, hashNumber(mine[0]!.phone_number, d.settings.numberHashKey), false)
      .catch((e) => { d.alert('TRIAL_START_FAILED'); throw e; });
    if (started.ok === false) {
      await d.track('trial_refused', userId, { reason: started.reason });
      if (started.reason === 'budget_used') d.alert('BUDGET_CAP_HIT', { at: 'trial' });
      const [status, code, message] = TRIAL_REFUSALS[started.reason] ?? TRIAL_REFUSALS.trial_full!;
      throw new PhoneError(status, code, message);
    }
    newTrial = !started.already;
  }
  const country = input.country === 'CA' ? 'CA' : 'US';
  const areaCode = typeof input.area_code === 'string' && /^[2-9]\d\d$/.test(input.area_code) ? input.area_code : undefined;
  const row = await x.numbers.insertNumber({ kind: 'personal', country, user_id: userId });
  // Another request is buying: its trial is left alone.
  if (!row) throw new PhoneError(409, 'PHONE_NUMBER_PENDING', 'Your number is already being set up.');
  let bought: NumberRow;
  try { bought = await buy(d, x, row, areaCode); }
  catch (e) {
    if (trial) await x.numbers.cancelTrial(userId).catch(() => d.alert('TRIAL_CANCEL_FAILED'));
    await d.track('own_number_failed', userId, { reason: e instanceof PhoneError ? e.code.toLowerCase() : 'error' });
    throw e;
  }
  await d.track('own_number_added', userId, { funding: trial ? 'trial' : 'subscription', country });
  if (newTrial) await d.track('trial_started', userId, { country });
  return bought;
}

/** The person ends the free trial: the number and the agent go at once. A paid number ends with its subscription. */
export async function endTrialByUser(d: PhoneDeps, x: PhoneExtras, userId: string): Promise<{ released: boolean }> {
  if (isLive(await x.numbers.subscription(userId), d.now())) throw new PhoneError(409, 'PHONE_NUMBER_PAID', 'This number belongs to a subscription.');
  const number = await x.numbers.personalNumber(userId);
  const trial = await x.numbers.trialState(userId);
  if (!trial || (!number && trial.ended_at)) throw new PhoneError(404, 'PHONE_NUMBER_NOT_FOUND', 'Number not found.');
  if (trial.open_call) throw new PhoneError(409, 'PHONE_CALL_IN_PROGRESS', 'Another call is still in progress.');
  if (number?.status === 'buying') throw new PhoneError(409, 'PHONE_NUMBER_PENDING', 'Your number is already being set up.');
  if (await x.numbers.endTrial(userId, 'ended_by_user')) await d.track('trial_ended', userId, { reason: 'ended_by_user' });
  // A release that fails is repeated by the maintenance pass.
  return { released: number ? await releaseNumberRow(d, x, number, 'ended_by_user') : true };
}

/** Owner action only (internal route): a shared number, paid by the company within the cap. */
export async function addSharedNumber(d: PhoneDeps, x: PhoneExtras, country: 'US' | 'CA', areaCode?: string): Promise<NumberRow> {
  const row = await x.numbers.insertNumber({ kind: 'pool', country, user_id: null });
  if (!row) throw new PhoneError(409, 'PHONE_NUMBERS_UNAVAILABLE', 'The number could not be added.');
  return buy(d, x, row, areaCode);
}

export async function releaseNumberRow(d: PhoneDeps, x: PhoneExtras, row: NumberRow, reason: string): Promise<boolean> {
  try {
    if (row.agent_id && row.user_id && x.calldesk) await x.calldesk.deleteAgent(row.agent_id, row.user_id);
    if (row.provider_sid) await d.gateway.releaseNumber(row.provider_sid);
  } catch (e) {
    d.alert('NUMBER_RELEASE_FAILED', { code: carrierCode(e) });
    return false;
  }
  await x.numbers.updateNumber(row.id, { status: 'released', released_at: new Date(d.now()).toISOString(), agent_id: null });
  if (row.kind === 'personal' && row.user_id) {
    // Removes what the agent service still holds for the account and frees its place there.
    if (x.calldesk && !(await resultPending(d, x, row.user_id))) {
      await x.calldesk.deleteUser(row.user_id).catch(() => d.alert('AGENT_USER_DELETE_FAILED'));
    }
    await d.track('own_number_released', row.user_id, { reason });
  }
  return true;
}

/** Whether a recent agent call of this account has no result yet. */
async function resultPending(d: PhoneDeps, x: PhoneExtras, userId: string): Promise<boolean> {
  const since = new Date(d.now() - 3600_000).toISOString();
  const waiting = await x.numbers.agentCallsWithoutResult(since, new Date(d.now()).toISOString());
  return waiting.some((c) => c.user_id === userId);
}

/** A trial that ran out of time or agent time, or was switched off. Null while it goes on. */
function trialEndReason(d: PhoneDeps, x: PhoneExtras, t: TrialState): string | null {
  if (!x.trialOn()) return 'switched_off';
  if (Date.parse(t.ends_at) <= d.now()) return 'expired';
  return t.seconds_left < 60 ? 'used_up' : null;
}

async function maintainNumber(d: PhoneDeps, x: PhoneExtras, n: NumberRow): Promise<void> {
  if (n.status === 'buying') {
    if (d.now() - Date.parse(n.created_at) > 3600_000) d.alert('NUMBER_STUCK_BUYING');
    return;
  }
  if (n.kind === 'personal') {
    const s = n.user_id ? await x.numbers.subscription(n.user_id) : null;
    const trial = n.user_id ? await x.numbers.trialState(n.user_id) : null;
    if (isLive(s, d.now())) {
      if (trial && !trial.ended_at && (await x.numbers.endTrial(n.user_id!, 'subscribed'))) await d.track('trial_ended', n.user_id!, { reason: 'subscribed' });
    } else if (trial && !trial.ended_at) {
      let reason = trialEndReason(d, x, trial);
      if (!reason) {
        // A new month's rent must fit the company cap, or the trial ends.
        const rent = await x.numbers.bookRent(n.id, true);
        if (rent.ok === true) return;
        if (rent.reason !== 'budget_used') { d.alert('NUMBER_MAINTENANCE_FAILED'); return; }
        reason = 'budget';
        d.alert('BUDGET_CAP_HIT', { at: 'trial_rent' });
      }
      // A call under way, or one still being written up, finishes first.
      if (trial.open_call || (await resultPending(d, x, n.user_id!))) return;
      if (await x.numbers.endTrial(n.user_id!, reason)) await d.track('trial_ended', n.user_id!, { reason });
      if (!(await releaseNumberRow(d, x, n, reason))) d.alert('TRIAL_RELEASE_FAILED');
      return;
    }
    const ended = !s || Date.parse(s.expires_at) + NUMBER_GRACE_MS < d.now();
    // Never release on stale information: Google must have been asked since the end.
    const fresh = !s || d.now() - Date.parse(s.checked_at) < 12 * 3600_000;
    if (ended && fresh) {
      const released = await releaseNumberRow(d, x, n, trial ? 'trial_ended' : 'subscription_ended');
      if (!released && trial?.ended_at && d.now() - Date.parse(trial.ended_at) > 3600_000) d.alert('TRIAL_RELEASE_OVERDUE');
      return;
    }
  }
  const rent = await x.numbers.bookRent(n.id, false);
  if (rent.ok === true && rent.overCap) d.alert('RENT_OVER_CAP');
}

/** Rechecks subscriptions with Google, books each month's rent, releases numbers whose subscription or trial ended. */
export async function maintainNumbers(d: PhoneDeps, x: PhoneExtras): Promise<void> {
  for (const s of await x.numbers.subscriptionsToCheck(new Date(d.now() - 6 * 3600_000).toISOString())) {
    try {
      const info = await x.play.get(s.purchase_token);
      const line = info.lineItems?.find((l) => l.productId === s.product_id);
      const expires = Date.parse(line?.expiryTime ?? '') || Date.parse(s.expires_at);
      await x.numbers.saveSubscription({
        ...subscriptionRow(d, x, s.user_id, s.purchase_token, info, expires, s),
        // Amounts agreed at purchase stay; only a new verification changes them.
        call_seconds: s.call_seconds, agent_seconds: s.agent_seconds, product_id: s.product_id,
        state: info.subscriptionState ?? s.state,
      });
    } catch (e) { d.alert('PLAY_RECHECK_FAILED', { code: carrierCode(e) }); }
  }
  for (const n of await x.numbers.liveNumbers()) {
    try { await maintainNumber(d, x, n); }
    catch { d.alert('NUMBER_MAINTENANCE_FAILED'); }
  }
  await x.numbers.sweepTrials(!x.trialOn()).catch(() => d.alert('TRIAL_SWEEP_FAILED'));
}
