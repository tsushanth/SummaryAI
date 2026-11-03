/**
 * First-party activation funnel (flagged OFF by default).
 *
 *   POST /api/activation/events       anonymous, allow-listed event names, 204 on accepted/ignored, 400 on junk, 429 when rate limited
 *   POST /api/activation/attribution  Bearer-authenticated, first write wins
 *
 * Enabled only when ACTIVATION_EVENTS_ENABLED=true (a Fly env change). Flag off: both endpoints answer 204 and write nothing.
 * Mounted before the auth-required groups (like /api/attribution); the events route is public by design.
 */
import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import {
  ANON_LIMIT, IP_LIMIT, createLimiter, validateAttribution, validateEvent,
  type ActivationEventRow, type AttributionRow,
} from '../services/activationEvents.js';

export interface ActivationDeps {
  enabled(): boolean;
  insertEvent(row: ActivationEventRow): Promise<void>;
  insertAttribution(row: AttributionRow): Promise<void>;
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
    const { error } = await supabaseAdmin.from('signup_attribution').upsert(row, { onConflict: 'user_id', ignoreDuplicates: true });
    if (error) throw new Error(error.code ?? 'db');
  },
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
    try { await d.insertEvent({ ...probe, user_id: userId }); }
    catch (e) { console.error('[Activation] event insert failed:', (e as Error).message); } // never fail the client
    res.status(204).end();
  });

  router.post('/attribution', (req, res, next) => {
    if (!d.enabled()) return void res.status(204).end();
    authMw(req, res, next);
  }, async (req: Request, res: Response) => {
    const row = validateAttribution(req.body, req.user!.id);
    if (!row) return void res.status(204).end();
    try { await d.insertAttribution(row); }
    catch (e) { console.error('[Activation] attribution insert failed:', (e as Error).message); }
    res.status(204).end();
  });

  return router;
}

export default createActivationRouter();
