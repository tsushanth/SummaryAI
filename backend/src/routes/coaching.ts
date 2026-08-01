/**
 * Realtime AI Coaching API routes.
 *
 * Endpoints (all require auth):
 *   GET    /api/coaching/credits                    — current credit balance
 *   POST   /api/coaching/sessions                   — start a session (debits 1 credit)
 *   GET    /api/coaching/sessions/:id/stream        — SSE: live insights for the session
 *   POST   /api/coaching/sessions/:id/end           — end the session (auto-refunds if light)
 *   GET    /api/coaching/sessions/:id/insights      — full insight list for post-meeting view
 *
 * See REALTIME_COACHING.md for design rationale.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';
import {
  getCreditBalance,
  startSession,
  endSession,
  subscribe,
  getInsights,
  grantCredits,
  NoCreditsError,
  InvalidPersonaError,
} from '../services/coachingService.js';
import { PERSONAS } from '../services/coachingPersonas.js';
import { getSubscriptionPurchase, acknowledgeSubscription } from '../services/googlePlayBilling.js';

const COACHING_SUBSCRIPTION_PRODUCTS = new Set<string>([
  'mm_coach_unlimited_monthly',
]);
const COACHING_SUBSCRIPTION_MONTHLY_CREDITS = 50;

const router = Router();
router.use(authenticate);

const FREE_TIER_CREDITS = 2;

// ----- POST /api/coaching/credits/claim-free -----
//
// One-shot free tier: 2 sessions on first tap of "Enable AI Coach". Idempotent
// via a fixed source_event_id keyed by user — calling twice grants once.
router.post('/credits/claim-free', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const sourceEventId = `free-tier:${userId}`;
  const result = await grantCredits(userId, FREE_TIER_CREDITS, 'free', { sourceEventId });
  const granted = !!result && !result.alreadyExisted;
  const balance = await getCreditBalance(userId);
  res.json({ granted, balance, free_tier_credits: FREE_TIER_CREDITS });
}));

// ----- GET /api/coaching/credits -----

router.get('/credits', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const balance = await getCreditBalance(userId);
  // Also return per-source breakdown for the in-app paywall to render
  // "X free + Y from your monthly plan + Z purchased".
  const { data: rows } = await supabaseAdmin
    .from('coaching_credits')
    .select('source, balance, expires_at')
    .eq('user_id', userId)
    .gt('balance', 0);

  const bySource = (rows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + (r.balance ?? 0);
    return acc;
  }, {});

  res.json({ balance, by_source: bySource });
}));

// ----- POST /api/coaching/credits/grant-debug -----
//
// DEBUG ONLY: grant 5 coaching credits per call to the requesting user. Used
// by the iOS/Android dev builds to test the coaching flow before real IAPs
// clear App Store / Play Store review. No gating in code — only the DEBUG
// client builds call this; if you're worried about abuse, gate later via
// an X-Debug-Token header against a Fly secret.
router.post('/credits/grant-debug', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const sourceEventId = `debug-grant:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await grantCredits(userId, 5, 'manual', { sourceEventId });
  const balance = await getCreditBalance(userId);
  res.json({ granted: 5, balance });
}));

// ----- POST /api/coaching/sessions -----

const startSchema = z.object({
  recording_id: z.string().uuid(),
  persona: z.string().min(1),
});

router.post('/sessions', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const body = startSchema.parse(req.body);

  try {
    const { sessionId } = await startSession(userId, body.recording_id, body.persona);
    res.status(201).json({ session_id: sessionId, persona: body.persona });
  } catch (err) {
    if (err instanceof NoCreditsError) return res.status(402).json({ error: 'no_credits', message: 'No coaching credits available.' });
    if (err instanceof InvalidPersonaError) return res.status(400).json({ error: 'invalid_persona', message: err.message, available: Object.keys(PERSONAS) });
    throw err;
  }
}));

// ----- GET /api/coaching/sessions/:id/stream (SSE) -----

router.get('/sessions/:id/stream', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const sessionId = req.params.id;

  // Auth check: session must belong to this user
  const { data: session } = await supabaseAdmin
    .from('coaching_sessions')
    .select('user_id, ended_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId) throw Errors.notFound('Session not found.');
  if (session.ended_at) throw Errors.badRequest('Session already ended.');

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const emit = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Hand any insights already emitted on session start (in case of reconnect)
  const existing = await getInsights(sessionId);
  for (const i of existing) emit('insight', i);

  // Subscribe to new insights
  const unsubscribe = subscribe(sessionId, emit);

  // Heartbeat every 20s to keep proxies happy
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}));

// ----- POST /api/coaching/sessions/:id/end -----

router.post('/sessions/:id/end', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const sessionId = req.params.id;

  const { data: session } = await supabaseAdmin
    .from('coaching_sessions')
    .select('user_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId) throw Errors.notFound('Session not found.');

  const { refunded } = await endSession(sessionId);
  res.json({ ended: true, refunded });
}));

// ----- GET /api/coaching/sessions/:id/insights -----

router.get('/sessions/:id/insights', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const sessionId = req.params.id;

  const { data: session } = await supabaseAdmin
    .from('coaching_sessions')
    .select('user_id, persona, started_at, ended_at, insight_count, refunded')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId) throw Errors.notFound('Session not found.');

  const insights = await getInsights(sessionId);
  res.json({ session, insights });
}));

// ----- POST /api/coaching/iap/google-play/verify -----
//
// Android client posts the BillingClient purchase token + product id after a
// successful purchase. We verify with Play Developer API, then grant credits
// idempotently keyed by latestOrderId (one grant per billing period).

const verifyPlaySchema = z.object({
  purchase_token: z.string().min(20),
  product_id: z.string().min(1),
});

router.post('/iap/google-play/verify', asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { purchase_token, product_id } = verifyPlaySchema.parse(req.body);

  if (!COACHING_SUBSCRIPTION_PRODUCTS.has(product_id)) {
    return res.status(400).json({ error: 'unsupported_product', product_id });
  }

  let purchase;
  try {
    purchase = await getSubscriptionPurchase(purchase_token);
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.message || 'unknown';
    return res.status(400).json({ error: 'verify_failed', message: msg });
  }

  const lineItem = purchase.lineItems?.find(li => li.productId === product_id);
  if (!lineItem) {
    return res.status(400).json({ error: 'product_mismatch', message: 'Purchase does not contain this product.' });
  }
  const state = purchase.subscriptionState;
  const active = state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';
  if (!active) {
    return res.status(400).json({ error: 'not_active', state });
  }

  const orderId = purchase.latestOrderId || purchase_token;
  const sourceEventId = `gp:${orderId}`;
  const expiresAt = lineItem.expiryTime ? new Date(lineItem.expiryTime) : undefined;

  const result = await grantCredits(userId, COACHING_SUBSCRIPTION_MONTHLY_CREDITS, 'subscription', {
    productId: product_id,
    sourceEventId,
    expiresAt,
  });

  if (purchase.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
    try { await acknowledgeSubscription(product_id, purchase_token); }
    catch (e: any) { console.warn('[Coaching] acknowledge failed (non-fatal):', e?.message || e); }
  }

  const balance = await getCreditBalance(userId);
  const granted = !!result && !result.alreadyExisted;
  console.log(`[Coaching] Play verify ${product_id} user=${userId} granted=${granted} orderId=${orderId}`);
  res.json({
    granted,
    already_existed: result?.alreadyExisted ?? false,
    balance,
    expires_at: expiresAt?.toISOString() ?? null,
  });
}));

// ----- GET /api/coaching/personas (public listing) -----

router.get('/personas', (_req, res) => {
  res.json({
    personas: Object.values(PERSONAS).map(p => ({
      key: p.key,
      display_name: p.displayName,
      description: p.description,
    })),
  });
});

export default router;
