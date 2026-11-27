/**
 * First-party activation funnel (flagged OFF by default).
 *
 *   POST /api/activation/events       anonymous, allow-listed event names, 204 on accepted/ignored, 400 on junk, 429 when rate limited
 *   POST /api/activation/attribution  Bearer-authenticated, first write wins
 *
 * Enabled only when ACTIVATION_EVENTS_ENABLED=true (a Fly env change). Flag off: both endpoints answer 204 and write nothing.
 * Separately, when OUTREACH_EVENTS_URL is set the attribution endpoint also reports a signup for first touches that came from an
 * outreach link (utm_source=outreach) to the outreach metrics layer, see services/outreachEvents.ts. That works with or without
 * ACTIVATION_EVENTS_ENABLED (without it nothing is stored here).
 * Mounted before the auth-required groups (like /api/attribution); the events route is public by design.
 */
import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { outreachAttribution, outreachEnabled, reportOutreachEvent, type OutreachAttribution } from '../services/outreachEvents.js';
import {
  ANON_LIMIT, IP_LIMIT, createLimiter, validateAttribution, validateEvent,
  type ActivationEventRow, type AttributionRow,
} from '../services/activationEvents.js';
import { isAutomatedUserAgent, isTestAccount } from '../services/testTraffic.js';

export interface ActivationDeps {
  enabled(): boolean;
  insertEvent(row: ActivationEventRow): Promise<void>;
  /** Resolves false when the user already had a row (first write wins); anything else counts as newly written. */
  insertAttribution(row: AttributionRow): Promise<boolean | void>;
  /** Outreach metrics layer (OUTREACH_EVENTS_URL set). Independent of `enabled`. */
  outreachEnabled(): boolean;
  reportSignup(attribution: OutreachAttribution, email: string): void;
  /** Our own and automated accounts are not reported to the outreach counts. */
  isTestAccount(userId: string): Promise<boolean>;
  /** Optional Bearer user; null for anonymous or any auth trouble (this endpoint must never fail the client). */
  resolveUser(req: Request): Promise<string | null>;
  limiter: ReturnType<typeof createLimiter>;
}

async function resolveUserViaMiddleware(req: Request): Promise<string | null> {
  if (!req.headers.authorization) return null;
  return new Promise((resolve) => {
    const fakeRes: any = { status() { resolve(null); return fakeRes; }, json() { resolve(null); return fakeRes; } };
    optionalAuth(req, fakeRes as Response, () => resolve(req.user?.id ?? null)).catch(() => resolve(null));
  });
}

const defaults = (): ActivationDeps => ({
  enabled: () => process.env.ACTIVATION_EVENTS_ENABLED === 'true',
  insertEvent: async (row) => { const { error } = await supabaseAdmin.from('activation_events').insert(row); if (error) throw new Error(error.code ?? 'db'); },
  insertAttribution: async (row) => {
    // With ignoreDuplicates only a newly written row comes back, so an empty result means the first touch was already stored.
    const { data, error } = await supabaseAdmin.from('signup_attribution').upsert(row, { onConflict: 'user_id', ignoreDuplicates: true }).select('user_id');
    if (error) throw new Error(error.code ?? 'db');
    return (data?.length ?? 0) > 0;
  },
  outreachEnabled: () => outreachEnabled(),
  reportSignup: (attribution, email) => reportOutreachEvent({ event: 'signup', attribution, email }),
  isTestAccount,
  resolveUser: resolveUserViaMiddleware,
  limiter: createLimiter(),
});

export function createActivationRouter(overrides: Partial<ActivationDeps> = {}, authMw: any = authenticate): Router {
  const d: ActivationDeps = { ...defaults(), ...overrides };
  const router = Router();

  router.post('/events', async (req: Request, res: Response) => {
    if (!d.enabled()) return void res.status(204).end();
    const ip = req.ip || 'unknown';
    if (!d.limiter.take(`ip:${ip}`, 1, IP_LIMIT.limit, IP_LIMIT.windowMs)) return void res.status(429).json({ error: 'rate_limited' });
    // Validate before touching auth so junk never costs a Supabase call.
    const probe = validateEvent(req.body, null);
    if (!probe) return void res.status(400).json({ error: 'bad_request' });
    if (!d.limiter.take(`anon:${probe.anon_id}`, 1, ANON_LIMIT.limit, ANON_LIMIT.windowMs)) return void res.status(429).json({ error: 'rate_limited' });
    let userId: string | null = null;
    try { userId = await d.resolveUser(req); } catch { userId = null; }
    // Headless browsers, crawlers and command-line checks are stored, marked as test. The user agent is not stored.
    const props = isAutomatedUserAgent(req.get('user-agent'))
      ? { ...probe.props, test: true, test_reason: 'automated_agent' }
      : probe.props;
    try { await d.insertEvent({ ...probe, props, user_id: userId }); }
    catch (e) { console.error('[Activation] event insert failed:', (e as Error).message); } // never fail the client
    res.status(204).end();
  });

  router.post('/attribution', (req, res, next) => {
    if (!d.enabled() && !d.outreachEnabled()) return void res.status(204).end();
    authMw(req, res, next);
  }, async (req: Request, res: Response) => {
    const row = validateAttribution(req.body, req.user!.id);
    if (!row) return void res.status(204).end();
    let inserted = true;
    if (d.enabled()) {
      try { inserted = (await d.insertAttribution(row)) !== false; }
      catch (e) { console.error('[Activation] attribution insert failed:', (e as Error).message); }
    }
    // Outreach metrics: only for a first touch that came from an outreach link. Fire and forget, never delays or fails the client.
    try {
      const attribution = inserted && d.outreachEnabled()
        ? outreachAttribution({ utm_source: row.utm_source, utm_campaign: row.utm_campaign, utm_content: (req.body as Record<string, unknown> | undefined)?.utm_content })
        : null;
      const email = req.user?.email;
      if (attribution && email && !(await d.isTestAccount(req.user!.id))) d.reportSignup(attribution, email);
    } catch { /* swallowed on purpose */ }
    res.status(204).end();
  });

  return router;
}

export default createActivationRouter();
