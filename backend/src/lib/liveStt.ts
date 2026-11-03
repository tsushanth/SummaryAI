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
export function planLiveStt(env: LiveSttEnv): LiveSttPlan {
  const wanted = (env.LIVE_STT_PROVIDER ?? 'recall').trim().toLowerCase();
  const provider: LiveSttProvider | null =
    wanted === 'soniox' ? 'soniox' : env.LIVE_STT_SHADOW === 'true' ? 'shadow' : null;
  // 'recall' (and any unknown value) without shadow is the unchanged default.
  if (!provider) return { provider: 'recall' };

  const secret = (env.LIVE_STT_INGEST_SECRET ?? '').trim();
  const base = (env.LIVE_STT_WS_URL ?? '').trim().replace(/\/+$/, '');
  const okScheme = env.NODE_ENV === 'production' ? /^wss:\/\/[^/?#\s]+$/i.test(base) : /^wss?:\/\/[^/?#\s]+$/i.test(base);
  if (!secret || !okScheme) return { provider: 'recall', reason: 'misconfigured' };
  return { provider, wsBase: base, ingestSecret: secret };
}

export function mintLiveSttRef(): string {
  return randomUUID();
}

/** HMAC-SHA256(secret, ref), lowercase hex. Identical to live-stt/src/auth.ts mintIngestToken. */
export function mintIngestToken(secret: string, ref: string): string {
  return createHmac('sha256', secret).update(ref).digest('hex');
}

/** `<wsBase>/ingest/<ref>/?token=<hex>`. The `/` before `?` is required by Recall (HTTP 400 without it). */
export function buildIngestUrl(wsBase: string, secret: string, ref: string): string {
  return `${wsBase}/ingest/${ref}/?token=${mintIngestToken(secret, ref)}`;
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
