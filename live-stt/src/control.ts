import { createHmac, timingSafeEqual } from 'node:crypto';
import { SONIOX_LANGUAGES } from './languages.js';

/**
 * Backend -> service control channel (live language change). The backend signs
 *   v1=hex(HMAC-SHA256(secret, "control.<x-mm-timestamp>.<raw body>"))
 * The `control.` prefix keeps it distinct from the segment-sink signature (`<ts>.<body>`) that uses the same shared secret, so a
 * captured sink request is useless here. Identical to backend/src/lib/liveStt.ts signLiveControl.
 */
export function signControl(secret: string, timestampSec: string, rawBody: string | Buffer): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  return 'v1=' + createHmac('sha256', secret).update(`control.${timestampSec}.${body}`).digest('hex');
}

export const CONTROL_TOLERANCE_SEC = 300;

/** Constant-time check against every configured secret (no early exit), timestamp within +/-5 minutes. */
export function verifyControl(o: {
  secrets: string[];
  timestampSec: string | undefined;
  signature: string | undefined;
  rawBody: string | Buffer;
  nowSec: number;
}): boolean {
  if (!o.timestampSec || !o.signature || o.secrets.length === 0) return false;
  if (!/^\d{1,12}$/.test(o.timestampSec)) return false;
  if (Math.abs(o.nowSec - Number(o.timestampSec)) > CONTROL_TOLERANCE_SEC) return false;
  const got = Buffer.from(o.signature);
  let ok = false;
  for (const s of o.secrets) {
    const want = Buffer.from(signControl(s, o.timestampSec, o.rawBody));
    if (want.length === got.length && timingSafeEqual(want, got)) ok = true;
  }
  return ok;
}

export interface ControlBody {
  ref: string;
  /** 'auto' or a Soniox language code. */
  language: string;
}

const REF_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Strict parse: {v:1, ref, language} and nothing else. null on any deviation. */
export function parseControlBody(raw: string): ControlBody | null {
  let j: any;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const keys = Object.keys(j).sort().join(',');
  if (keys !== 'language,ref,v' || j.v !== 1) return null;
  if (typeof j.ref !== 'string' || !REF_RE.test(j.ref)) return null;
  if (typeof j.language !== 'string') return null;
  const language = j.language.trim().toLowerCase();
  if (language !== 'auto' && !SONIOX_LANGUAGES.has(language)) return null;
  return { ref: j.ref, language };
}
