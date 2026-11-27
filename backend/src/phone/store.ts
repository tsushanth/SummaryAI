/**
 * Database operations of the phone feature. The spend rules are SQL functions (migration 032); this only calls them.
 * Every method throws when the database cannot answer, so that a caller can never treat "unknown" as "allowed".
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type Refusal = { ok: false; reason: string };

export interface PhoneRow {
  id: string;
  user_id: string;
  phone_number: string;
  status: 'pending' | 'verified' | 'failed';
  verified_at: string | null;
  verification_expires_at: string | null;
  twilio_caller_id_sid: string | null;
  validation_call_sid: string | null;
  failure_reason: string | null;
  created_at: string;
}

export interface CallRow {
  id: string;
  user_id: string;
  from_number: string;
  to_number: string;
  to_name: string | null;
  twilio_call_sid: string | null;
  status: string;
  twilio_account: string | null;
  output_language: string | null;
  call_language: string | null;
  recording_sid: string | null;
  recording_duration: number | null;
  recording_id: string | null;
  recording_stored_at: string | null;
  recording_deleted_at: string | null;
  transcript_result: string | null;
  failure_reason: string | null;
  answered_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface LedgerCall {
  call_id: string;
  user_id: string | null;
  state: 'reserved' | 'settled' | 'released';
  call_sid: string | null;
  claimed_at: string | null;
  notice_served_at: string | null;
  reserved_seconds: number;
  actual_seconds: number | null;
}

export interface Budget { minutes_per_month: number; minutes_left: number; month_spent_micro: number; cap_micro: number; halted: boolean }

export interface UserInfo { email: string; isAnonymous: boolean; banned: boolean }

export interface PhoneStore {
  reserveVerification(userId: string, numberHash: string): Promise<{ ok: true; ledgerId: number } | Refusal>;
  releaseVerification(ledgerId: number): Promise<void>;
  reserveCall(a: { callId: string; userId: string; fromHash: string; destHash: string; from: string; to: string }): Promise<{ ok: true; limitSeconds: number; minutesLeft: number } | Refusal>;
  claimCall(callId: string, userId: string, callSid: string): Promise<{ ok: true; to: string; from: string; limitSeconds: number } | Refusal>;
  noticeServed(callId: string, parentCallSid: string): Promise<boolean>;
  settleCall(callId: string, appSeconds: number, talkSeconds: number, unknown: boolean): Promise<{ ok: true; costMicro: number; talkSeconds: number; overReservation: boolean } | Refusal>;
  releaseCall(callId: string, userId: string): Promise<boolean>;
  releaseStale(): Promise<number>;
  budget(userId: string, numberHash: string | null): Promise<Budget>;
  halt(reason: string): Promise<void>;
  openCalls(): Promise<LedgerCall[]>;
  ledgerCall(callId: string): Promise<LedgerCall | null>;

  phonesOfUser(userId: string): Promise<PhoneRow[]>;
  phoneById(id: string): Promise<PhoneRow | null>;
  verifiedOwner(phone: string): Promise<string | null>;
  /** Creates or resets this account's row for the number to a fresh pending attempt. */
  savePendingPhone(a: { userId: string; phone: string; ledgerId: number; expiresAt: string }): Promise<PhoneRow>;
  /** Records which carrier call belongs to the pending attempt. */
  setValidationCall(id: string, callSid: string): Promise<void>;
  /** Pending -> verified. False when the row was not pending or the number already has an owner. */
  markVerified(id: string, callerIdSid: string): Promise<boolean>;
  markVerifyFailed(id: string, reason: string): Promise<boolean>;
  deletePhone(id: string, userId: string): Promise<void>;

  insertCall(row: Partial<CallRow> & { id: string; user_id: string; from_number: string; to_number: string }): Promise<void>;
  getCall(id: string): Promise<CallRow | null>;
  callBySid(callSid: string): Promise<CallRow | null>;
  updateCall(id: string, patch: Record<string, unknown>): Promise<void>;
  listCalls(userId: string, limit: number, offset: number): Promise<{ calls: CallRow[]; total: number }>;
  /** Reserves the recording for this call. False when the call already holds a different recording. */
  claimRecording(callId: string, recordingSid: string): Promise<boolean>;
  /** Calls on the calls subaccount whose audio is not saved yet, or whose carrier copy still has to be deleted. */
  callsNeedingRecordingWork(sinceIso: string, beforeIso: string): Promise<CallRow[]>;
  /** Saved recordings whose transcription outcome has not been reported yet. */
  callsAwaitingTranscript(sinceIso: string): Promise<CallRow[]>;

  recordingStatus(recordingId: string): Promise<{ status: string; error_code: string | null } | null>;
  uploadAudio(path: string, audio: Buffer): Promise<void>;
  /** 'exists' when the row is already there (a repeated webhook). */
  insertRecording(row: Record<string, unknown> & { id: string }): Promise<'inserted' | 'exists'>;

  userInfo(userId: string): Promise<UserInfo | null>;
  /** Whether the account was already asked "Is this for a business?" (any answer, a skip included). */
  hasAnsweredBusiness(userId: string): Promise<boolean>;
}

const CALL_COLUMNS =
  'id, user_id, from_number, to_number, to_name, twilio_call_sid, status, twilio_account, output_language, call_language, recording_sid, recording_duration, recording_id, recording_stored_at, recording_deleted_at, transcript_result, failure_reason, answered_at, ended_at, created_at';
const PHONE_COLUMNS =
  'id, user_id, phone_number, status, verified_at, verification_expires_at, twilio_caller_id_sid, validation_call_sid, failure_reason, created_at';
const LEDGER_COLUMNS = 'call_id, user_id, state, call_sid, claimed_at, notice_served_at, reserved_seconds, actual_seconds';

export function createSupabaseStore(db: SupabaseClient<any, any, any>, audioBucket: string): PhoneStore {
  // Error messages carry the database code only: a Postgres message can quote the row, numbers included.
  const check = <T>(r: { data: T; error: { code?: string } | null }, what: string): T => {
    if (r.error) throw new Error(`phone db ${what}: ${r.error.code ?? 'error'}`);
    return r.data;
  };
  const rpc = async <T = any>(fn: string, args: Record<string, unknown>): Promise<T> => check(await db.rpc(fn, args), fn) as T;
  const answer = <T extends { ok?: unknown }>(r: T, what: string): T => {
    if (!r || typeof r.ok !== 'boolean') throw new Error(`phone db ${what}: no answer`);
    return r;
  };

  return {
    async reserveVerification(userId, numberHash) {
      const r = answer(await rpc('phone_reserve_verification', { p_user: userId, p_number_hash: numberHash }), 'reserve_verification');
      return r.ok ? { ok: true, ledgerId: Number(r.ledger_id) } : { ok: false, reason: String(r.reason) };
    },
    async releaseVerification(ledgerId) { await rpc('phone_release_verification', { p_ledger_id: ledgerId }); },
    async reserveCall(a) {
      const r = answer(await rpc('phone_reserve_call', { p_call: a.callId, p_user: a.userId, p_from_hash: a.fromHash, p_dest_hash: a.destHash, p_from: a.from, p_to: a.to }), 'reserve_call');
      if (!r.ok) return { ok: false, reason: String(r.reason) };
      const limit = Number(r.limit_seconds);
      if (!(limit >= 60)) throw new Error('phone db reserve_call: no time limit');
      return { ok: true, limitSeconds: limit, minutesLeft: Number(r.minutes_left) };
    },
    async claimCall(callId, userId, callSid) {
      const r = answer(await rpc('phone_claim_call', { p_call: callId, p_user: userId, p_call_sid: callSid }), 'claim_call');
      if (!r.ok) return { ok: false, reason: String(r.reason) };
      if (!r.to_number || !r.from_number || !(Number(r.limit_seconds) >= 60)) throw new Error('phone db claim_call: incomplete');
      return { ok: true, to: String(r.to_number), from: String(r.from_number), limitSeconds: Number(r.limit_seconds) };
    },
    async noticeServed(callId, parentCallSid) { return (await rpc<boolean>('phone_notice_served', { p_call: callId, p_parent_call_sid: parentCallSid })) === true; },
    async settleCall(callId, appSeconds, talkSeconds, unknown) {
      const r = answer(await rpc('phone_settle_call', { p_call: callId, p_app_seconds: appSeconds, p_talk_seconds: talkSeconds, p_unknown: unknown }), 'settle_call');
      return r.ok ? { ok: true, costMicro: Number(r.cost_micro), talkSeconds: Number(r.talk_seconds), overReservation: r.over_reservation === true } : { ok: false, reason: String(r.reason) };
    },
    async releaseCall(callId, userId) { return (await rpc<boolean>('phone_release_call', { p_call: callId, p_user: userId })) === true; },
    async releaseStale() { return Number(await rpc('phone_release_stale', {})); },
    async budget(userId, numberHash) { return rpc<Budget>('phone_budget', { p_user: userId, p_number_hash: numberHash }); },
    async halt(reason) { await rpc('phone_halt', { p_reason: reason }); },
    async openCalls() {
      return check(await db.from('phone_ledger').select(LEDGER_COLUMNS).eq('kind', 'call').eq('state', 'reserved').not('claimed_at', 'is', null).order('created_at').limit(100), 'open_calls') as unknown as LedgerCall[];
    },
    async ledgerCall(callId) {
      return check(await db.from('phone_ledger').select(LEDGER_COLUMNS).eq('call_id', callId).maybeSingle(), 'ledger_call') as unknown as LedgerCall | null;
    },

    async phonesOfUser(userId) {
      return check(await db.from('verified_phones').select(PHONE_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }), 'phones') as unknown as PhoneRow[];
    },
    async phoneById(id) { return check(await db.from('verified_phones').select(PHONE_COLUMNS).eq('id', id).maybeSingle(), 'phone') as unknown as PhoneRow | null; },
    async verifiedOwner(phone) {
      const rows = check(await db.from('verified_phones').select('user_id').eq('phone_number', phone).eq('status', 'verified').limit(1), 'owner') as unknown as { user_id: string }[];
      return rows[0]?.user_id ?? null;
    },
    async savePendingPhone(a) {
      const row = {
        user_id: a.userId, phone_number: a.phone, status: 'pending', verified_at: null, twilio_caller_id_sid: null, verification_code: null,
        failure_reason: null, ledger_id: a.ledgerId, validation_call_sid: null, verification_expires_at: a.expiresAt,
        created_at: new Date().toISOString(),
      };
      return check(await db.from('verified_phones').upsert(row, { onConflict: 'user_id,phone_number' }).select(PHONE_COLUMNS).single(), 'save_phone') as unknown as PhoneRow;
    },
    async setValidationCall(id, callSid) { check(await db.from('verified_phones').update({ validation_call_sid: callSid }).eq('id', id).eq('status', 'pending'), 'set_validation_call'); },
    async markVerified(id, callerIdSid) {
      const r = await db.from('verified_phones')
        .update({ status: 'verified', verified_at: new Date().toISOString(), twilio_caller_id_sid: callerIdSid, failure_reason: null })
        .eq('id', id).eq('status', 'pending').select('id');
      if (r.error?.code === '23505') return false; // another account owns this number
      return ((check(r, 'mark_verified') as unknown[]) ?? []).length > 0;
    },
    async markVerifyFailed(id, reason) {
      const rows = check(await db.from('verified_phones').update({ status: 'failed', failure_reason: reason }).eq('id', id).eq('status', 'pending').select('id'), 'mark_failed') as unknown[];
      return rows.length > 0;
    },
    async deletePhone(id, userId) { check(await db.from('verified_phones').delete().eq('id', id).eq('user_id', userId), 'delete_phone'); },

    async insertCall(row) { check(await db.from('phone_calls').insert(row), 'insert_call'); },
    async getCall(id) { return check(await db.from('phone_calls').select(CALL_COLUMNS).eq('id', id).maybeSingle(), 'get_call') as unknown as CallRow | null; },
    async callBySid(callSid) {
      const rows = check(await db.from('phone_calls').select(CALL_COLUMNS).eq('twilio_call_sid', callSid).eq('twilio_account', 'phone').limit(1), 'call_by_sid') as unknown as CallRow[];
      return rows[0] ?? null;
    },
    async updateCall(id, patch) { check(await db.from('phone_calls').update(patch).eq('id', id), 'update_call'); },
    async listCalls(userId, limit, offset) {
      const r = await db.from('phone_calls').select(CALL_COLUMNS, { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
      return { calls: (check(r, 'list_calls') as unknown as CallRow[]) ?? [], total: r.count ?? 0 };
    },
    async claimRecording(callId, recordingSid) {
      if (!/^RE[0-9a-f]{32}$/i.test(recordingSid)) return false;
      const rows = check(await db.from('phone_calls').update({ recording_sid: recordingSid }).eq('id', callId)
        .or(`recording_sid.is.null,recording_sid.eq.${recordingSid}`).select('id'), 'claim_recording') as unknown[];
      return rows.length > 0;
    },
    async callsNeedingRecordingWork(sinceIso, beforeIso) {
      return check(await db.from('phone_calls').select(CALL_COLUMNS).eq('twilio_account', 'phone').not('twilio_call_sid', 'is', null)
        .gt('created_at', sinceIso).lt('created_at', beforeIso).is('recording_deleted_at', null).order('created_at').limit(50), 'recording_work') as unknown as CallRow[];
    },
    async callsAwaitingTranscript(sinceIso) {
      return check(await db.from('phone_calls').select(CALL_COLUMNS).eq('twilio_account', 'phone').not('recording_stored_at', 'is', null)
        .is('transcript_result', null).gt('created_at', sinceIso).order('created_at').limit(50), 'awaiting_transcript') as unknown as CallRow[];
    },

    async recordingStatus(recordingId) {
      return check(await db.from('recordings').select('status, error_code').eq('id', recordingId).maybeSingle(), 'recording_status') as unknown as { status: string; error_code: string | null } | null;
    },
    async uploadAudio(path, audio) {
      const { error } = await db.storage.from(audioBucket).upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
      if (error) throw new Error('phone db upload_audio: storage');
    },
    async insertRecording(row) {
      const { error } = await db.from('recordings').insert(row);
      if (!error) return 'inserted';
      if (error.code === '23505') return 'exists';
      throw new Error(`phone db insert_recording: ${error.code ?? 'error'}`);
    },

    async hasAnsweredBusiness(userId) {
      const rows = check(await db.from('activation_events').select('id').eq('user_id', userId).eq('name', 'phone_step')
        .eq('props->>step', 'business_answer').limit(1), 'business_answered') as unknown[];
      return rows.length > 0;
    },

    async userInfo(userId) {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (error || !data?.user) return null;
      const u = data.user as typeof data.user & { is_anonymous?: boolean; banned_until?: string };
      return { email: u.email ?? '', isAnonymous: u.is_anonymous === true, banned: !!u.banned_until && Date.parse(u.banned_until) > Date.now() };
    },
  };
}
