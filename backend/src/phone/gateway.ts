/**
 * Everything the phone feature asks of the carrier, on the calls subaccount only. Tests use a fake.
 * Never log what these return or the message of what they throw: both can contain phone numbers. Log carrierCode().
 */
import Twilio from 'twilio';
import type { PhoneSettings } from './settings.js';

export interface CarrierCall { sid: string; status: string; durationSeconds: number }
export interface CarrierRecording { sid: string; status: string; durationSeconds: number }

export interface TelephonyGateway {
  /** Rings the number; the person types the returned code on the keypad to register it as an outgoing caller ID. */
  requestValidation(phone: string, statusCallbackUrl: string): Promise<{ code: string; callSid: string }>;
  findCallerId(phone: string): Promise<{ sid: string; createdAt: Date | null } | null>;
  deleteCallerId(sid: string): Promise<'deleted' | 'not_found'>;
  accessToken(identity: string, ttlSeconds: number): string;
  fetchCall(sid: string): Promise<CarrierCall | null>;
  childCalls(parentSid: string): Promise<CarrierCall[]>;
  endCall(sid: string): Promise<void>;
  listRecordings(callSid: string): Promise<CarrierRecording[]>;
  downloadRecording(recordingSid: string): Promise<Buffer>;
  deleteRecording(recordingSid: string): Promise<'deleted' | 'not_found'>;
  isValidRequest(signature: string, url: string, params: Record<string, string>): boolean;
}

/** A short, number-free description of a carrier error for logs and events. */
export function carrierCode(e: unknown): string {
  const x = e as { code?: unknown; status?: unknown; name?: unknown } | null;
  if (typeof x?.code === 'number') return `twilio_${x.code}`;
  if (typeof x?.status === 'number') return `http_${x.status}`;
  const n = String(x?.name ?? 'error');
  return /^[A-Za-z]{1,30}$/.test(n) ? n : 'error';
}

/**
 * The only form in which an unexpected error leaves the phone code (logs, error reporter): our own database messages,
 * which carry a database code only, or a carrier code. Never a carrier message, which can quote a number.
 */
export function safeError(e: unknown): Error {
  const m = e instanceof Error ? e.message : '';
  return new Error(/^phone db [a-z_]+: [A-Za-z0-9_ ]+$/.test(m) ? m : `phone: ${carrierCode(e)}`);
}

const isNotFound = (e: unknown) => (e as { status?: number })?.status === 404 || (e as { code?: number })?.code === 20404;
const seconds = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

export function createTwilioGateway(s: PhoneSettings): TelephonyGateway {
  const client = new Twilio.Twilio(s.accountSid, s.authToken, { timeout: 15_000 });
  const toCall = (c: { sid: string; status: string; duration?: string }): CarrierCall => ({ sid: c.sid, status: c.status, durationSeconds: seconds(c.duration) });
  return {
    async requestValidation(phone, statusCallbackUrl) {
      const r = await client.validationRequests.create({
        phoneNumber: phone,
        friendlyName: 'MeetingMind user',
        statusCallback: statusCallbackUrl,
        statusCallbackMethod: 'POST',
      });
      return { code: String(r.validationCode), callSid: r.callSid };
    },
    async findCallerId(phone) {
      const [found] = await client.outgoingCallerIds.list({ phoneNumber: phone, limit: 1 });
      return found ? { sid: found.sid, createdAt: found.dateCreated ?? null } : null;
    },
    async deleteCallerId(sid) {
      try { await client.outgoingCallerIds(sid).remove(); return 'deleted'; }
      catch (e) { if (isNotFound(e)) return 'not_found'; throw e; }
    },
    accessToken(identity, ttlSeconds) {
      const AccessToken = Twilio.jwt.AccessToken;
      const token = new AccessToken(s.accountSid, s.apiKeySid, s.apiKeySecret, { identity, ttl: ttlSeconds });
      token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: s.twimlAppSid, incomingAllow: false }));
      return token.toJwt();
    },
    async fetchCall(sid) {
      try { return toCall(await client.calls(sid).fetch()); }
      catch (e) { if (isNotFound(e)) return null; throw e; }
    },
    async childCalls(parentSid) {
      return (await client.calls.list({ parentCallSid: parentSid, limit: 20 })).map(toCall);
    },
    async endCall(sid) {
      try { await client.calls(sid).update({ status: 'completed' }); }
      catch (e) { if (!isNotFound(e)) throw e; }
    },
    async listRecordings(callSid) {
      return (await client.recordings.list({ callSid, limit: 20 })).map((r) => ({ sid: r.sid, status: r.status, durationSeconds: seconds(r.duration) }));
    },
    async downloadRecording(recordingSid) {
      if (!/^RE[0-9a-f]{32}$/i.test(recordingSid)) throw new Error('bad recording id');
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s.accountSid}/Recordings/${recordingSid}.mp3`, {
        headers: { Authorization: `Basic ${Buffer.from(`${s.accountSid}:${s.authToken}`).toString('base64')}` },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw Object.assign(new Error('recording download failed'), { status: res.status });
      return Buffer.from(await res.arrayBuffer());
    },
    async deleteRecording(recordingSid) {
      try { await client.recordings(recordingSid).remove(); return 'deleted'; }
      catch (e) { if (isNotFound(e)) return 'not_found'; throw e; }
    },
    isValidRequest(signature, url, params) {
      return !!signature && Twilio.validateRequest(s.authToken, signature, url, params);
    },
  };
}
