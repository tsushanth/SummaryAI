/** Database operations of numbers, subscriptions and agents (migration 033). Throws when the database cannot answer. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Refusal } from './store.js';
import type { AgentResult } from './calldesk.js';

export interface NumberRow {
  id: string;
  phone_number: string | null;
  country: 'US' | 'CA';
  kind: 'pool' | 'personal';
  provider_sid: string | null;
  user_id: string | null;
  status: 'buying' | 'active' | 'released';
  agent_id: string | null;
  agent_language: string | null;
  agent_description: string | null;
  created_at: string;
}

export interface SubscriptionRow {
  user_id: string;
  product_id: string;
  token_hash: string;
  purchase_token: string;
  state: string;
  period_start: string;
  expires_at: string;
  call_seconds: number;
  agent_seconds: number;
  checked_at: string;
}

export interface AgentCallRow { id: string; user_id: string; agent_id: string; created_at: string }

export type LegKind = 'call' | 'inbound' | 'agent';

export interface NumbersStore {
  numberByE164(e164: string): Promise<NumberRow | null>;
  /** The account's personal number that is not released. */
  personalNumber(userId: string): Promise<NumberRow | null>;
  liveNumbers(): Promise<NumberRow[]>;
  /** Null when the account already has a personal number (database rule). */
  insertNumber(row: { kind: 'pool' | 'personal'; country: 'US' | 'CA'; user_id: string | null }): Promise<NumberRow | null>;
  updateNumber(id: string, patch: Partial<NumberRow> & { released_at?: string }): Promise<void>;
  bookRent(numberId: string, requireRoom: boolean): Promise<{ ok: true; already?: boolean; overCap?: boolean } | Refusal>;
  releaseRent(numberId: string): Promise<void>;
  assignRoute(userId: string, phoneId: string, remoteHash: string, country: string): Promise<{ ok: true; phoneNumber: string; numberId: string } | Refusal>;
  routeFor(numberId: string, remoteHash: string): Promise<{ user_id: string; phone_id: string } | null>;
  reserveLeg(a: { kind: LegKind; callId: string; userId: string; numberId: string; userHash: string | null; remoteHash: string; from: string; to: string; callSid: string | null; company: boolean }): Promise<{ ok: true; limitSeconds: number } | Refusal>;
  settleLeg(callId: string, seconds: number, unknown: boolean): Promise<{ ok: true; costMicro: number; talkSeconds: number; overReservation: boolean } | Refusal>;
  reserveDraft(userId: string): Promise<{ ok: true } | Refusal>;
  subLeft(userId: string, what: 'call' | 'agent'): Promise<number>;
  subscription(userId: string): Promise<SubscriptionRow | null>;
  subscriptionOwner(tokenHash: string): Promise<string | null>;
  saveSubscription(row: SubscriptionRow): Promise<void>;
  /** Subscriptions not asked about for a while, or about to end. */
  subscriptionsToCheck(checkedBeforeIso: string): Promise<SubscriptionRow[]>;
  saveAgentResult(callId: string, result: AgentResult): Promise<void>;
  agentCallsWithoutResult(sinceIso: string, beforeIso: string): Promise<AgentCallRow[]>;
}

const NUMBER = 'id, phone_number, country, kind, provider_sid, user_id, status, agent_id, agent_language, agent_description, created_at';
const SUB = 'user_id, product_id, token_hash, purchase_token, state, period_start, expires_at, call_seconds, agent_seconds, checked_at';

export function createSupabaseNumbersStore(db: SupabaseClient<any, any, any>): NumbersStore {
  const check = <T>(r: { data: T; error: { code?: string } | null }, what: string): T => {
    if (r.error) throw new Error(`phone db ${what}: ${r.error.code ?? 'error'}`);
    return r.data;
  };
  const rpc = async <T = any>(fn: string, args: Record<string, unknown>): Promise<T> => check(await db.rpc(fn, args), fn) as T;
  const answer = (r: any, what: string) => {
    if (!r || typeof r.ok !== 'boolean') throw new Error(`phone db ${what}: no answer`);
    return r;
  };
  const refusal = (r: any): Refusal => ({ ok: false, reason: String(r.reason) });
  return {
    async numberByE164(e164) { return check(await db.from('phone_numbers').select(NUMBER).eq('phone_number', e164).eq('status', 'active').maybeSingle(), 'number') as unknown as NumberRow | null; },
    async personalNumber(userId) {
      const rows = check(await db.from('phone_numbers').select(NUMBER).eq('user_id', userId).eq('kind', 'personal').neq('status', 'released').limit(1), 'personal') as unknown as NumberRow[];
      return rows[0] ?? null;
    },
    async liveNumbers() { return check(await db.from('phone_numbers').select(NUMBER).neq('status', 'released').limit(500), 'live_numbers') as unknown as NumberRow[]; },
    async insertNumber(row) {
      const r = await db.from('phone_numbers').insert({ ...row, status: 'buying' }).select(NUMBER).single();
      if (r.error?.code === '23505') return null;
      return check(r, 'insert_number') as unknown as NumberRow;
    },
    async updateNumber(id, patch) { check(await db.from('phone_numbers').update(patch).eq('id', id), 'update_number'); },
    async bookRent(numberId, requireRoom) {
      const r = answer(await rpc('phone_book_rent', { p_number: numberId, p_require_room: requireRoom }), 'book_rent');
      return r.ok ? { ok: true, already: r.already === true, overCap: r.over_cap === true } : refusal(r);
    },
    async releaseRent(numberId) { await rpc('phone_release_rent', { p_number: numberId }); },
    async assignRoute(userId, phoneId, remoteHash, country) {
      const r = answer(await rpc('phone_assign_route', { p_user: userId, p_phone: phoneId, p_remote_hash: remoteHash, p_country: country }), 'assign_route');
      return r.ok ? { ok: true, phoneNumber: String(r.phone_number), numberId: String(r.number_id) } : refusal(r);
    },
    async routeFor(numberId, remoteHash) {
      return check(await db.from('phone_return_routes').select('user_id, phone_id').eq('number_id', numberId).eq('remote_hash', remoteHash).gt('expires_at', new Date().toISOString()).maybeSingle(), 'route') as unknown as { user_id: string; phone_id: string } | null;
    },
    async reserveLeg(a) {
      const r = answer(await rpc('phone_reserve_leg', {
        p_kind: a.kind, p_call: a.callId, p_user: a.userId, p_number_id: a.numberId, p_user_hash: a.userHash, p_remote_hash: a.remoteHash,
        p_from: a.from, p_to: a.to, p_call_sid: a.callSid, p_company: a.company,
      }), 'reserve_leg');
      if (!r.ok) return refusal(r);
      if (!(Number(r.limit_seconds) >= 60)) throw new Error('phone db reserve_leg: no time limit');
      return { ok: true, limitSeconds: Number(r.limit_seconds) };
    },
    async settleLeg(callId, seconds, unknown) {
      const r = answer(await rpc('phone_settle_leg', { p_call: callId, p_seconds: seconds, p_unknown: unknown }), 'settle_leg');
      return r.ok ? { ok: true, costMicro: Number(r.cost_micro), talkSeconds: Number(r.talk_seconds), overReservation: r.over_reservation === true } : refusal(r);
    },
    async reserveDraft(userId) { const r = answer(await rpc('phone_reserve_draft', { p_user: userId }), 'reserve_draft'); return r.ok ? { ok: true } : refusal(r); },
    async subLeft(userId, what) { return Number(await rpc('phone_sub_left', { p_user: userId, p_what: what })) || 0; },
    async subscription(userId) { return check(await db.from('phone_subscriptions').select(SUB).eq('user_id', userId).maybeSingle(), 'subscription') as unknown as SubscriptionRow | null; },
    async subscriptionOwner(tokenHash) {
      const r = check(await db.from('phone_subscriptions').select('user_id').eq('token_hash', tokenHash).maybeSingle(), 'sub_owner') as unknown as { user_id: string } | null;
      return r?.user_id ?? null;
    },
    async saveSubscription(row) { check(await db.from('phone_subscriptions').upsert(row, { onConflict: 'user_id' }), 'save_subscription'); },
    async subscriptionsToCheck(checkedBeforeIso) {
      return check(await db.from('phone_subscriptions').select(SUB).lt('checked_at', checkedBeforeIso).gt('expires_at', new Date(Date.now() - 40 * 86_400_000).toISOString()).order('checked_at').limit(50), 'subs_to_check') as unknown as SubscriptionRow[];
    },
    async saveAgentResult(callId, result) { check(await db.from('phone_calls').update({ agent_result: result }).eq('id', callId), 'save_result'); },
    async agentCallsWithoutResult(sinceIso, beforeIso) {
      return check(await db.from('phone_calls').select('id, user_id, agent_id, created_at').not('agent_id', 'is', null).is('agent_result', null)
        .gt('created_at', sinceIso).lt('created_at', beforeIso).limit(25), 'results_missing') as unknown as AgentCallRow[];
    },
  };
}
