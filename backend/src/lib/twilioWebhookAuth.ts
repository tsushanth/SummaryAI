import type { Request, Response, NextFunction } from 'express';
import { validateRequest } from 'twilio';
import { reportAlert } from './alerts.js';

/**
 * Twilio webhook authentication (X-Twilio-Signature).
 *
 * Documented scheme (https://www.twilio.com/docs/usage/security#validating-requests): the signature is
 * base64(HMAC-SHA1(AuthToken, fullUrlTwilioRequested + sorted POST params concatenated as name+value)). The URL is the
 * one Twilio called (scheme, host, path and query string), which for us is built from SERVICE_URL in twilioService.ts
 * (or configured on the TwiML App for the Voice SDK `voip-outbound` route).
 *
 * PHASE 1 (default): verify and LOG, never reject. Voice callbacks drive live calls, and a URL mismatch behind the Fly proxy
 * (scheme, host, `/v1` prefix) would otherwise break calls. grep the Fly logs for `"event":"webhook_auth"`:
 *   outcome "ok"      = Twilio-signed request verified (the candidate URL that matched is not logged, only that one did)
 *   outcome "failed", reason "no_signature_header" = request carried no X-Twilio-Signature (forged, or not from Twilio)
 *   outcome "failed", reason "signature_mismatch"  = signed but did not match any candidate URL: either a forgery or our URL
 *                                                    reconstruction differs from the URL Twilio used. Compare with SERVICE_URL.
 *   outcome "failed", reason "auth_token_not_configured" = TWILIO_AUTH_TOKEN missing
 * Enforce (phase 2) only after every real callback for every route logs "ok".
 */

export type TwilioVerdict = { ok: true } | { ok: false; reason: string };

export function candidateUrls(req: Pick<Request, 'originalUrl' | 'headers'>, serviceUrl: string | undefined): string[] {
  const path = req.originalUrl;
  const urls = new Set<string>();
  if (serviceUrl) urls.add(`${serviceUrl.replace(/\/+$/, '')}${path}`);
  const fwdHost = req.headers['x-forwarded-host'];
  const host = (Array.isArray(fwdHost) ? fwdHost[0] : fwdHost) ?? req.headers.host;
  if (host) {
    urls.add(`https://${host}${path}`);
    // The router is mounted both at /v1 and at the root; a TwiML App may have been configured with either.
    if (path.startsWith('/v1/')) urls.add(`https://${host}${path.slice(3)}`);
    else urls.add(`https://${host}/v1${path}`);
  }
  return [...urls];
}

export function verifyTwilioRequest(
  req: Pick<Request, 'originalUrl' | 'headers' | 'body'>,
  authToken: string | undefined,
  serviceUrl: string | undefined
): TwilioVerdict {
  if (!authToken) return { ok: false, reason: 'auth_token_not_configured' };
  const sig = req.headers['x-twilio-signature'];
  const signature = Array.isArray(sig) ? sig[0] : sig;
  if (!signature) return { ok: false, reason: 'no_signature_header' };
  const params = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>;
  for (const url of candidateUrls(req, serviceUrl)) {
    try {
      if (validateRequest(authToken, signature, url, params)) return { ok: true };
    } catch {
      /* try the next candidate */
    }
  }
  return { ok: false, reason: 'signature_mismatch' };
}

const counters = new Map<string, number>();
export function resetTwilioAuthCounters(): void {
  counters.clear();
}

/**
 * Express middleware for /webhooks/twilio/*. `enforce` false = phase 1 (log + alert, still call next()).
 * Logs header NAMES only (never values) and the route path without the query string.
 */
export function twilioWebhookAuth(opts: { enforce: boolean; authToken?: () => string | undefined; serviceUrl?: () => string | undefined }) {
  const getToken = opts.authToken ?? (() => process.env.TWILIO_AUTH_TOKEN || undefined);
  const getService = opts.serviceUrl ?? (() => process.env.SERVICE_URL || undefined);
  return (req: Request, res: Response, next: NextFunction): void => {
    const verdict = verifyTwilioRequest(req, getToken(), getService());
    const route = req.originalUrl.split('?')[0] ?? '';
    const reason = 'reason' in verdict ? verdict.reason : undefined;
    const key = `${route}:${reason ?? 'ok'}`;
    const count = (counters.get(key) ?? 0) + 1;
    counters.set(key, count);
    const line = {
      event: 'webhook_auth',
      provider: 'twilio',
      route,
      outcome: verdict.ok ? 'ok' : 'failed',
      reason,
      enforced: opts.enforce,
      count,
      headers: Object.keys(req.headers).sort(),
    };
    if (verdict.ok) {
      console.log(JSON.stringify(line));
      next();
      return;
    }
    console.warn(JSON.stringify(line));
    reportAlert('webhook_auth_twilio', String(reason).toUpperCase(), { route, count, enforced: opts.enforce });
    if (opts.enforce) {
      res.status(403).type('text/plain').send('Forbidden');
      return;
    }
    next();
  };
}
