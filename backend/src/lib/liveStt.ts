/**
 * Live transcription provider selection and the shared-secret primitives used by createBot and POST /internal/live-segments.
 * See backend/LIVE_STT.md. Everything defaults to today's behaviour (Recall's own transcript).
 *
 * Two independent secrets, matching the live-stt service (PR #34):
 *  - LIVE_STT_INGEST_SECRET  -> per-bot URL token, HMAC-SHA256(secret, ref) hex (service: INGEST_TOKEN_SECRETS)
 *  - LIVE_STT_SHARED_SECRET  -> request signature of the segment sink, `v1=` + hex HMAC-SHA256(secret, `${ts}.${rawBody}`)
 *                               (service: BACKEND_SINK_SECRET)
 * Nothing here logs or returns secret material.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type LiveSttProvider = 'recall' | 'soniox' | 'shadow';

export interface LiveSttEnv {
  LIVE_STT_PROVIDER?: string | undefined;
  LIVE_STT_SHADOW?: string | undefined;
  /** Comma separated user UUIDs allowed to be shadowed. Unset/empty = shadow is off for everyone (fails closed). */
  LIVE_STT_SHADOW_USER_IDS?: string | undefined;
  LIVE_STT_WS_URL?: string | undefined;
  LIVE_STT_INGEST_SECRET?: string | undefined;
  NODE_ENV?: string | undefined;
}

export type LiveSttPlan =
  | { provider: 'recall'; reason?: 'misconfigured' }
  | { provider: 'soniox' | 'shadow'; wsBase: string; ingestSecret: string };

/**
 * Decide, per bot, which path to use. Anything that is not a complete, valid configuration yields `recall`, so a half-set
 * environment can never produce a bot with no transcript at all.
 */
export function planLiveStt(env: LiveSttEnv, userId?: string): LiveSttPlan {
  const wanted = (env.LIVE_STT_PROVIDER ?? 'recall').trim().toLowerCase();
  const provider: LiveSttProvider | null =
    wanted === 'soniox' ? 'soniox' : env.LIVE_STT_SHADOW === 'true' && isShadowAllowed(env.LIVE_STT_SHADOW_USER_IDS, userId) ? 'shadow' : null;
  // 'recall' (and any unknown value) without shadow is the unchanged default.
  if (!provider) return { provider: 'recall' };

  const secret = (env.LIVE_STT_INGEST_SECRET ?? '').trim();
  const base = (env.LIVE_STT_WS_URL ?? '').trim().replace(/\/+$/, '');
  const okScheme = env.NODE_ENV === 'production' ? /^wss:\/\/[^/?#\s]+$/i.test(base) : /^wss?:\/\/[^/?#\s]+$/i.test(base);
  if (!secret || !okScheme) return { provider: 'recall', reason: 'misconfigured' };
  return { provider, wsBase: base, ingestSecret: secret };
}

/**
 * Shadow streams a meeting's audio to a second speech vendor, so it is opt-in per USER, not just per deployment: only a user whose
 * id is in LIVE_STT_SHADOW_USER_IDS is shadowed. Unset, empty, or a call without a user id = not shadowed (fails closed).
 * Compared case-insensitively on the whole id. Does not apply to LIVE_STT_PROVIDER=soniox (that is a deliberate global switch).
 */
export function isShadowAllowed(allowList: string | undefined, userId: string | undefined): boolean {
  const id = (userId ?? '').trim().toLowerCase();
  if (!id) return false;
  return parseSecretList(allowList).some((a) => a.toLowerCase() === id);
}

export function mintLiveSttRef(): string {
  return randomUUID();
}

/** HMAC-SHA256(secret, ref), lowercase hex. Identical to live-stt/src/auth.ts mintIngestToken. */
export function mintIngestToken(secret: string, ref: string): string {
  return createHmac('sha256', secret).update(ref).digest('hex');
}

/**
 * `<wsBase>/ingest/<ref>/?token=<hex>[&lang=<code>]`. The `/` before `?` is required by Recall (HTTP 400 without it).
 * `lang` is the Soniox language hint chosen for the meeting; omitted for auto, so the default URL is unchanged. It is not covered
 * by the token (the token stays HMAC(secret, ref)): it can only bias recognition, and only whoever already holds the URL can edit it.
 */
export function buildIngestUrl(wsBase: string, secret: string, ref: string, lang?: string): string {
  const base = `${wsBase}/ingest/${ref}/?token=${mintIngestToken(secret, ref)}`;
  return lang && /^[a-z]{2,3}$/.test(lang) ? `${base}&lang=${lang}` : base;
}

/**
 * Signature of the backend -> live-stt control call: `v1=` + hex HMAC-SHA256(secret, `control.${timestampSec}.${rawBody}`).
 * The `control.` prefix separates it from the segment-sink signature, so a captured sink request can never be replayed here
 * (and the strict body schemas differ as well). Identical to live-stt/src/control.ts signControl.
 */
export function signLiveControl(secret: string, timestampSec: string, rawBody: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`control.${timestampSec}.${rawBody}`).digest('hex');
}

/** `v1=` + hex HMAC-SHA256(secret, `${timestampSec}.${rawBody}`). Same as live-stt/src/sink/httpSink.ts signBody. */
export function signLiveSegments(secret: string, timestampSec: string, rawBody: string | Buffer): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  return 'v1=' + createHmac('sha256', secret).update(`${timestampSec}.${body}`).digest('hex');
}

export const LIVE_SEGMENTS_TOLERANCE_SEC = 300;

/** Constant-time check against every configured secret (no early exit), timestamp within +/-5 minutes. */
export function verifyLiveSegments(opts: {
  secrets: string[];
  timestampSec: string | undefined;
  signature: string | undefined;
  rawBody: Buffer | string;
  nowSec: number;
}): boolean {
  const { secrets, timestampSec, signature, rawBody, nowSec } = opts;
  if (!timestampSec || !signature || secrets.length === 0) return false;
  if (!/^\d{1,12}$/.test(timestampSec)) return false;
  if (Math.abs(nowSec - Number(timestampSec)) > LIVE_SEGMENTS_TOLERANCE_SEC) return false;
  const got = Buffer.from(signature);
  let ok = false;
  for (const s of secrets) {
    const want = Buffer.from(signLiveSegments(s, timestampSec, rawBody));
    if (want.length === got.length && timingSafeEqual(want, got)) ok = true;
  }
  return ok;
}

export function parseSecretList(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
