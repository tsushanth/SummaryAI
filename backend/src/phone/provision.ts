/**
 * Numbers and the subscription that pays for a personal one. A subscription counts only after Google Play confirms it to
 * the server. A number is bought only after its first month is booked in the ledger.
 */
import { createHash } from 'node:crypto';
import { PhoneError, type PhoneDeps, type PhoneExtras } from './deps.js';
import { carrierCode } from './gateway.js';
import { parsePhoneNumber } from './numbers.js';
import { webhookUrl } from './settings.js';
import { verifiedPhones } from './verification.js';
import type { NumberRow, SubscriptionRow } from './numbersStore.js';

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

export async function verifySubscription(d: PhoneDeps, x: PhoneExtras, userId: string, input: { purchase_token?: unknown; product_id?: unknown }): Promise<SubscriptionRow> {
  const plan = x.plan();
  if (!plan.purchaseEnabled) throw new PhoneError(403, 'PHONE_PURCHASE_OFF', 'Buying a number is not available yet.');
  const token = typeof input.purchase_token === 'string' ? input.purchase_token : '';
  if (input.product_id !== plan.productId || token.length < 20 || token.length > 4096) throw new PhoneError(400, 'PHONE_PURCHASE_INVALID', 'That purchase cannot be used.');
  let info: PlaySubscription;
  try { info = await x.play.get(token); }
  catch (e) {
    d.alert('PLAY_VERIFY_FAILED', { code: carrierCode(e) });
    throw new PhoneError(502, 'PHONE_PURCHASE_NOT_CHECKED', 'The purchase could not be checked with Google Play. Try again.');
  }
  const line = info.lineItems?.find((l) => l.productId === plan.productId);
  const expires = Date.parse(line?.expiryTime ?? '');
  const bound = info.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (!line || !LIVE_STATES.has(info.subscriptionState ?? '') || !(expires > d.now()) || (bound && bound !== sha256(userId))) {
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

export async function provisionPersonalNumber(d: PhoneDeps, x: PhoneExtras, userId: string, input: { country?: unknown; area_code?: unknown }): Promise<NumberRow> {
  if (!x.plan().purchaseEnabled) throw new PhoneError(403, 'PHONE_PURCHASE_OFF', 'Buying a number is not available yet.');
  if (!isLive(await x.numbers.subscription(userId), d.now())) throw new PhoneError(403, 'PHONE_SUBSCRIPTION_REQUIRED', 'A subscription is needed for your own number.');
  const mine = verifiedPhones(await d.store.phonesOfUser(userId));
  if (!mine.length) throw new PhoneError(403, 'PHONE_NOT_VERIFIED', 'Verify your phone number first.');
  const existing = await x.numbers.personalNumber(userId);
  if (existing?.status === 'active') return existing;
  const country = input.country === 'CA' ? 'CA' : 'US';
  const areaCode = typeof input.area_code === 'string' && /^[2-9]\d\d$/.test(input.area_code) ? input.area_code : undefined;
  const row = await x.numbers.insertNumber({ kind: 'personal', country, user_id: userId });
  if (!row) throw new PhoneError(409, 'PHONE_NUMBER_PENDING', 'Your number is already being set up.');
  return buy(d, x, row, areaCode);
}

/** Owner action only (internal route): a shared number, paid by the company within the cap. */
export async function addSharedNumber(d: PhoneDeps, x: PhoneExtras, country: 'US' | 'CA', areaCode?: string): Promise<NumberRow> {
  const row = await x.numbers.insertNumber({ kind: 'pool', country, user_id: null });
  if (!row) throw new PhoneError(409, 'PHONE_NUMBERS_UNAVAILABLE', 'The number could not be added.');
  return buy(d, x, row, areaCode);
}

export async function releaseNumberRow(d: PhoneDeps, x: PhoneExtras, row: NumberRow): Promise<boolean> {
  try {
    if (row.agent_id && row.user_id && x.calldesk) await x.calldesk.deleteAgent(row.agent_id, row.user_id);
    if (row.provider_sid) await d.gateway.releaseNumber(row.provider_sid);
  } catch (e) {
    d.alert('NUMBER_RELEASE_FAILED', { code: carrierCode(e) });
    return false;
  }
  await x.numbers.updateNumber(row.id, { status: 'released', released_at: new Date(d.now()).toISOString(), agent_id: null });
  return true;
}

/** Rechecks subscriptions with Google, books each month's rent, releases numbers whose subscription ended. */
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
    if (n.status === 'buying') {
      if (d.now() - Date.parse(n.created_at) > 3600_000) d.alert('NUMBER_STUCK_BUYING');
      continue;
    }
    if (n.kind === 'personal') {
      const s = n.user_id ? await x.numbers.subscription(n.user_id) : null;
      const ended = !s || Date.parse(s.expires_at) + NUMBER_GRACE_MS < d.now();
      // Never release on stale information: Google must have been asked since the end.
      const fresh = !s || d.now() - Date.parse(s.checked_at) < 12 * 3600_000;
      if (ended && fresh) { await releaseNumberRow(d, x, n); continue; }
    }
    const rent = await x.numbers.bookRent(n.id, false);
    if (rent.ok === true && rent.overCap) d.alert('RENT_OVER_CAP');
  }
}
