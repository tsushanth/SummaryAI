/**
 * Two server-to-server entries of the phone feature:
 *  - POST /webhooks/calldesk: results of agent calls, signed by Calldesk (HMAC over timestamp and raw body).
 *  - /internal/phone/*: owner actions (add a shared number, read the funnel). Require x-internal-secret and fail closed.
 */
import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { PhoneDeps } from '../phone/deps.js';
import { getPhoneDeps } from '../phone/index.js';
import { readCalldeskSettings, verifyCalldeskSignature } from '../phone/calldesk.js';
import { storeAgentResult } from '../phone/agents.js';
import { addSharedNumber } from '../phone/provision.js';
import { safeError } from '../phone/gateway.js';

export function createCalldeskWebhookRouter(getDeps: () => PhoneDeps | null = getPhoneDeps, secret = () => readCalldeskSettings()?.webhookSecret ?? ''): Router {
  const router = Router();
  router.post('/', (req: Request, res: Response, next) => {
    const d = getDeps();
    const ok = verifyCalldeskSignature(secret(), req.get('x-calldesk-timestamp') ?? '', req.get('x-calldesk-signature') ?? '',
      (req as Request & { rawBody?: Buffer }).rawBody);
    if (!d?.extras || !ok) return void res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid signature' } });
    if (req.body?.event !== 'call.completed') return void res.status(204).end();
    storeAgentResult(d, d.extras, req.body.data).then(() => res.status(204).end()).catch((e) => next(safeError(e)));
  });
  return router;
}

const secretMatches = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return !!expected && a.length === b.length && timingSafeEqual(a, b);
};

export function createPhoneInternalRouter(
  getDeps: () => PhoneDeps | null = getPhoneDeps,
  funnel: (sinceIso: string) => Promise<unknown>,
  secret = () => process.env.INTERNAL_SECRET ?? '',
  stepCounts: (sinceIso: string) => Promise<unknown> = async () => [],
): Router {
  const router = Router();
  router.use((req, res, next) => {
    if (!secretMatches(req.get('x-internal-secret') ?? '', secret())) return void res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid secret' } });
    next();
  });
  /** /funnel: people per stage and segment. /steps: how often each step happened and why it failed. Counts only. */
  const counts = (path: string, read: (sinceIso: string) => Promise<unknown>) => router.get(path, (req, res, next) => {
    const days = Math.min(Math.max(parseInt(String(req.query.days), 10) || 30, 1), 365);
    read(new Date(Date.now() - days * 86_400_000).toISOString()).then((rows) => res.json({ days, rows })).catch((e) => next(safeError(e)));
  });
  counts('/funnel', funnel);
  counts('/steps', stepCounts);
  router.post('/shared-number', (req, res, next) => {
    const d = getDeps();
    const country = req.body?.country;
    if (!d?.extras) return void res.status(503).json({ error: { code: 'PHONE_NOT_CONFIGURED', message: 'Numbers are not set up.' } });
    if (country !== 'US' && country !== 'CA') return void res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'country must be US or CA' } });
    const areaCode = typeof req.body?.area_code === 'string' && /^[2-9]\d\d$/.test(req.body.area_code) ? req.body.area_code : undefined;
    addSharedNumber(d, d.extras, country, areaCode)
      .then((n) => res.status(201).json({ id: n.id, country: n.country, status: n.status }))
      .catch((e) => (e?.name === 'PhoneError' ? res.status(e.status).json({ error: { code: e.code, message: e.message } }) : next(safeError(e))));
  });
  return router;
}
