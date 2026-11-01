import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Recall.ai webhook verification (Svix scheme).
 * Source: https://docs.recall.ai/docs/authenticating-requests-from-recallai
 *  - Headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (workspace verification secret; accounts created on/after
 *    2025-12-15 and all real-time endpoints) or the legacy `svix-id`, `svix-timestamp`, `svix-signature` (per-endpoint secret).
 *  - `*-signature` is a space-separated list of `v1,<base64 HMAC-SHA256>` over `${id}.${timestamp}.${rawBody}`; the HMAC key is the
 *    base64-decoded part of the `whsec_...` secret after the prefix.
 * The signature covers the EXACT bytes Recall sent, so callers must pass the raw body, not JSON.stringify(req.body).
 *
 * This module only decides; the route chooses what to do with a failure (phase 1 logs and accepts, phase 2 rejects).
 * It never throws and never returns or logs secret material.
 */

export const RECALL_TOLERANCE_SECONDS = 5 * 60;
const PREFIXES = ['webhook', 'svix'] as const;

export type RecallVerdict = { ok: true; scheme: string; headerNames: string[] } | { ok: false; reason: string; headerNames: string[] };
type Headers = Record<string, string | string[] | undefined>;

function one(headers: Headers, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Names (never values) of the signature-related headers present. */
export function signatureHeaderNames(headers: Headers): string[] {
  const names: string[] = [];
  for (const p of PREFIXES) for (const s of ['id', 'timestamp', 'signature']) if (one(headers, `${p}-${s}`)) names.push(`${p}-${s}`);
  return names;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyRecallWebhook(opts: {
  rawBody: Buffer | string | undefined;
  headers: Headers;
  secrets: Array<string | undefined>;
  nowMs?: number;
}): RecallVerdict {
  const headerNames = signatureHeaderNames(opts.headers);
  const secrets = opts.secrets.filter((s): s is string => !!s);
  if (secrets.length === 0) return { ok: false, reason: 'no_secret', headerNames };
  if (opts.rawBody === undefined) return { ok: false, reason: 'no_raw_body', headerNames };
  const nowMs = opts.nowMs ?? Date.now();
  const body = Buffer.isBuffer(opts.rawBody) ? opts.rawBody.toString('utf8') : opts.rawBody;

  let partial = false;
  let stale = false;
  for (const prefix of PREFIXES) {
    const id = one(opts.headers, `${prefix}-id`);
    const timestamp = one(opts.headers, `${prefix}-timestamp`);
    const signature = one(opts.headers, `${prefix}-signature`);
    if (!id && !timestamp && !signature) continue;
    if (!id || !timestamp || !signature) { partial = true; continue; }
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > RECALL_TOLERANCE_SECONDS) { stale = true; continue; }

    const provided = signature.split(' ').map((s) => s.split(',')).filter(([v, sig]) => v === 'v1' && !!sig).map(([, sig]) => sig as string);
    const toSign = `${id}.${timestamp}.${body}`;
    for (const secret of secrets) {
      const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
      if (key.length === 0) continue;
      const expected = createHmac('sha256', key).update(toSign, 'utf8').digest('base64');
      if (provided.some((sig) => safeEqual(sig, expected))) return { ok: true, scheme: prefix, headerNames };
    }
    return { ok: false, reason: 'bad_signature', headerNames };
  }
  if (stale) return { ok: false, reason: 'stale_timestamp', headerNames };
  if (partial) return { ok: false, reason: 'partial_headers', headerNames };
  return { ok: false, reason: 'no_signature_headers', headerNames };
}

/**
 * Express helper. PHASE 1: `enforce` false => log + alert on failure but return true (accept). Logs header NAMES only.
 *   fly logs | grep '"event":"webhook_auth"' ;  outcome "ok" = a genuine signed delivery verified;
 *   outcome "unverified_accepted" + reason = what to fix before enforcing.
 */
export function checkRecallWebhook(opts: {
  route: string;
  rawBody: Buffer | string | undefined;
  headers: Headers;
  secrets: Array<string | undefined>;
  enforce: boolean;
  alert: (flow: string, code: string, ctx: Record<string, unknown>) => void;
  log?: (line: string) => void;
}): { accept: boolean; verdict: RecallVerdict } {
  const verdict = verifyRecallWebhook(opts);
  const log = opts.log ?? ((l: string) => console.log(l));
  const line = {
    event: 'webhook_auth',
    provider: 'recall',
    route: opts.route,
    outcome: !('reason' in verdict) ? 'ok' : opts.enforce ? 'rejected' : 'unverified_accepted',
    scheme: 'scheme' in verdict ? verdict.scheme : undefined,
    reason: 'reason' in verdict ? verdict.reason : undefined,
    signatureHeaders: verdict.headerNames.join(',') || 'none',
  };
  log(JSON.stringify(line));
  if (!('reason' in verdict)) return { accept: true, verdict };
  opts.alert('webhook_auth_recall', verdict.reason.toUpperCase(), { route: opts.route, enforced: opts.enforce, signatureHeaders: line.signatureHeaders });
  return { accept: !opts.enforce, verdict };
}
