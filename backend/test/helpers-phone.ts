/**
 * Fakes for the phone services: an in-memory store (the SQL spend rules themselves are tested in phone-sql.test.ts) and a
 * carrier that records what it was asked to do. Signature checking uses the real Twilio algorithm.
 */
import Twilio from 'twilio';
import type { PhoneDeps } from '../src/phone/deps.js';
import type { CallRow, LedgerCall, PhoneRow, PhoneStore } from '../src/phone/store.js';
import type { CarrierCall, CarrierRecording, TelephonyGateway } from '../src/phone/gateway.js';

export const USER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const MY_NUMBER = '+15124550142';
export const DEST = '+14154550177';
export const CODE = '845913';
export const RE = (n: number) => `RE${String(n).padStart(32, '0')}`;
export const SETTINGS = {
  accountSid: 'AC00000000000000000000000000000000', authToken: 'test-auth-token', apiKeySid: 'SK0', apiKeySecret: 's', twimlAppSid: 'AP0',
  numberHashKey: 'test-hash-key', publicBaseUrl: 'https://api.example.test',
};

export function fakeWorld() {
  const phones: PhoneRow[] = [];
  const calls: CallRow[] = [];
  const ledger: (LedgerCall & { to?: string; from?: string })[] = [];
  const recordings: Record<string, any>[] = [];
  const uploads: { path: string; bytes: number }[] = [];
  const events: { step: string; user: string; props: Record<string, unknown> }[] = [];
  const alerts: string[] = [];
  const processed: string[] = [];
  const deferred: Array<() => Promise<unknown>> = [];
  const asked: string[] = [];
  const state = {
    now: Date.parse('2026-12-01T12:00:00Z'),
    verifyRefusal: null as string | null,
    reserveRefusal: null as string | null,
    ledgerDown: false,
    access: new Set([USER, OTHER]),
    user: { email: 'someone@gmail.com', isAnonymous: false, banned: false },
    callerIds: new Map<string, { sid: string; createdAt: Date }>(),
    carrierCalls: new Map<string, CarrierCall>(),
    children: new Map<string, CarrierCall[]>(),
    carrierRecordings: new Map<string, CarrierRecording[]>(),
    validationError: null as unknown,
    carrierDown: false,
    downloadFails: false,
    released: [] as number[],
    halted: false,
  };
  let seq = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const down = () => { if (state.ledgerDown) throw new Error('phone db rpc: 57P01'); };
  const iso = () => new Date(state.now).toISOString();

  const store: PhoneStore = {
    async reserveVerification() { down(); return state.verifyRefusal ? { ok: false, reason: state.verifyRefusal } : { ok: true, ledgerId: ++seq }; },
    async releaseVerification(id) { state.released.push(id); },
    async reserveCall(a) {
      down();
      if (state.reserveRefusal) return { ok: false, reason: state.reserveRefusal };
      ledger.push({ call_id: a.callId, user_id: a.userId, state: 'reserved', call_sid: null, claimed_at: null, notice_served_at: null, reserved_seconds: 1800, actual_seconds: null, to: a.to, from: a.from });
      return { ok: true, limitSeconds: 1800, minutesLeft: 30 };
    },
    async claimCall(callId, userId, callSid) {
      down();
      const l = ledger.find((x) => x.call_id === callId && x.user_id === userId && x.state === 'reserved' && !x.claimed_at);
      if (!l) return { ok: false, reason: 'not_claimable' };
      l.claimed_at = iso(); l.call_sid = callSid;
      return { ok: true, to: l.to!, from: l.from!, limitSeconds: l.reserved_seconds };
    },
    async noticeServed(callId, parent) {
      down();
      const l = ledger.find((x) => x.call_id === callId && x.call_sid === parent && x.claimed_at);
      if (!l) return false;
      l.notice_served_at = iso(); return true;
    },
    async settleCall(callId, app, talk, unknown) {
      const l = ledger.find((x) => x.call_id === callId && x.state === 'reserved' && x.claimed_at);
      if (!l) return { ok: false, reason: 'not_open' };
      l.state = 'settled'; l.actual_seconds = unknown ? l.reserved_seconds : talk;
      return { ok: true, costMicro: unknown ? 1_045_000 : Math.ceil(talk / 60) * 28_000 + Math.ceil(app / 60) * 5_000, talkSeconds: l.actual_seconds, overReservation: false };
    },
    async releaseCall(callId, userId) {
      const l = ledger.find((x) => x.call_id === callId && x.user_id === userId && x.state === 'reserved' && !x.claimed_at);
      if (!l) return false;
      l.state = 'released'; return true;
    },
    async releaseStale() { return 0; },
    async budget() { return { minutes_per_month: 30, minutes_left: 30, month_spent_micro: 0, cap_micro: 25_000_000, halted: state.halted }; },
    async halt() { state.halted = true; },
    async openCalls() { return ledger.filter((l) => l.state === 'reserved' && l.claimed_at); },
    async ledgerCall(id) { return ledger.find((l) => l.call_id === id) ?? null; },
    async phonesOfUser(u) { return phones.filter((p) => p.user_id === u).map((p) => ({ ...p })); },
    async phoneById(id) { const p = phones.find((x) => x.id === id); return p ? { ...p } : null; },
    async verifiedOwner(n) { return phones.find((p) => p.phone_number === n && p.status === 'verified')?.user_id ?? null; },
    async savePendingPhone(a) {
      let p = phones.find((x) => x.user_id === a.userId && x.phone_number === a.phone);
      if (!p) { p = { id: uuid(), user_id: a.userId, phone_number: a.phone } as PhoneRow; phones.push(p); }
      Object.assign(p, { status: 'pending', verified_at: null, twilio_caller_id_sid: null, validation_call_sid: null, failure_reason: null, verification_expires_at: a.expiresAt, created_at: iso() });
      return { ...p };
    },
    async setValidationCall(id, sid) { const p = phones.find((x) => x.id === id && x.status === 'pending'); if (p) p.validation_call_sid = sid; },
    async markVerified(id, sid) {
      const p = phones.find((x) => x.id === id && x.status === 'pending');
      if (!p || phones.some((x) => x !== p && x.phone_number === p.phone_number && x.status === 'verified')) return false;
      Object.assign(p, { status: 'verified', verified_at: iso(), twilio_caller_id_sid: sid }); return true;
    },
    async markVerifyFailed(id, reason) { const p = phones.find((x) => x.id === id && x.status === 'pending'); if (!p) return false; Object.assign(p, { status: 'failed', failure_reason: reason }); return true; },
    async deletePhone(id, u) { const i = phones.findIndex((x) => x.id === id && x.user_id === u); if (i >= 0) phones.splice(i, 1); },
    async insertCall(row) {
      calls.push({ twilio_call_sid: null, recording_sid: null, recording_duration: null, recording_id: null, recording_stored_at: null, recording_deleted_at: null, transcript_result: null, failure_reason: null, answered_at: null, ended_at: null, to_name: null, output_language: null, call_language: null, twilio_account: null, status: 'initiated', created_at: iso(), ...row });
    },
    async getCall(id) { const c = calls.find((x) => x.id === id); return c ? { ...c } : null; },
    async callBySid(sid) { return calls.find((c) => c.twilio_call_sid === sid) ?? null; },
    async updateCall(id, patch) { const c = calls.find((x) => x.id === id); if (c) Object.assign(c, patch); },
    async listCalls(u) { const mine = calls.filter((c) => c.user_id === u); return { calls: mine, total: mine.length }; },
    async claimRecording(id, sid) { const c = calls.find((x) => x.id === id); if (!c || (c.recording_sid && c.recording_sid !== sid)) return false; c.recording_sid = sid; return true; },
    async callsNeedingRecordingWork() { return calls.filter((c) => c.twilio_account === 'phone' && c.twilio_call_sid && !c.recording_deleted_at).map((c) => ({ ...c })); },
    async callsAwaitingTranscript() { return calls.filter((c) => c.recording_stored_at && !c.transcript_result).map((c) => ({ ...c })); },
    async recordingStatus(id) { const r = recordings.find((x) => x.id === id); return r ? { status: r.status, error_code: r.error_code ?? null } : null; },
    async uploadAudio(path, audio) { uploads.push({ path, bytes: audio.length }); },
    async insertRecording(row) { if (recordings.some((r) => r.id === row.id)) return 'exists'; recordings.push({ ...row }); return 'inserted'; },
    async userInfo() { return state.user; },
    async hasAnsweredBusiness(u) { return events.some((e) => e.user === u && e.step === 'business_answer'); },
  };

  const need = () => { if (state.carrierDown) throw Object.assign(new Error(`unreachable ${DEST}`), { status: 503 }); };
  const real = Twilio;
  const gateway: TelephonyGateway = {
    async requestValidation(phone, cb) {
      asked.push(`validate ${cb}`);
      if (state.validationError) throw state.validationError;
      return { code: CODE, callSid: 'CAvalidation' };
    },
    async findCallerId(n) { need(); return state.callerIds.get(n) ?? null; },
    async deleteCallerId(sid) { need(); asked.push(`delete-caller-id ${sid}`); for (const [n, v] of state.callerIds) if (v.sid === sid) state.callerIds.delete(n); return 'deleted'; },
    accessToken: (identity, ttl) => `token.${identity}.${ttl}`,
    async fetchCall(sid) { need(); return state.carrierCalls.get(sid) ?? null; },
    async childCalls(sid) { need(); return state.children.get(sid) ?? []; },
    async endCall(sid) { need(); asked.push(`end ${sid}`); },
    async listRecordings(sid) { need(); return state.carrierRecordings.get(sid) ?? []; },
    async downloadRecording(sid) { need(); if (state.downloadFails) throw Object.assign(new Error('x'), { status: 500 }); asked.push(`download ${sid}`); return Buffer.from('mp3-bytes'); },
    async deleteRecording(sid) { need(); asked.push(`delete-recording ${sid}`); for (const [k, list] of state.carrierRecordings) state.carrierRecordings.set(k, list.filter((r) => r.sid !== sid)); return 'deleted'; },
    isValidRequest: (signature, url, params) => real.validateRequest(SETTINGS.authToken, signature, url, params),
  };

  const deps: PhoneDeps = {
    settings: SETTINGS, store, gateway,
    track: async (step, user, props = {}) => { events.push({ step, user, props }); },
    alert: (code) => { alerts.push(code); },
    process: async (id) => { processed.push(id); },
    hasAccess: (u) => state.access.has(u),
    now: () => state.now,
    newId: uuid,
    later: (_ms, fn) => { deferred.push(fn); },
  };
  const runDeferred = async () => { while (deferred.length) await deferred.shift()!(); };
  const addVerified = (user = USER, number = MY_NUMBER) => {
    const row = { id: uuid(), user_id: user, phone_number: number, status: 'verified', verified_at: iso(), verification_expires_at: null, twilio_caller_id_sid: `PN${seq}`, validation_call_sid: null, failure_reason: null, created_at: iso() } as PhoneRow;
    phones.push(row); return row;
  };
  const steps = () => events.map((e) => e.step);
  return { deps, store, gateway, state, phones, calls, ledger, recordings, uploads, events, alerts, processed, asked, runDeferred, addVerified, steps };
}

export const sign = (url: string, params: Record<string, string>, token = SETTINGS.authToken) => Twilio.getExpectedTwilioSignature(token, url, params);
