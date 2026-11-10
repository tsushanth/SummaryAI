/**
 * Voice assistant routes (docs/VOICE_ASSISTANT.md).
 *
 *   POST /webhooks/recall-assistant        Recall real-time transcript events for bots created with the assistant endpoint.
 *                                          Auth: URL token (HMAC of INTERNAL_SECRET) or a valid Recall signature. Fail closed.
 *   GET  /internal/voice-assistant/rollup  Daily roll-up for the owner. Auth: x-internal-secret (INTERNAL_SECRET), fail closed.
 *   GET  /api/voice-assistant              The caller's effective state.   PUT  /api/voice-assistant  { enabled: boolean } opt in / out.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { reportAlert } from '../lib/alerts.js';
import { verifyRecallWebhook } from '../lib/recallWebhookAuth.js';
import { decideEnabled } from '../services/voiceAssistant/config.js';
import { getVoiceAssistantManager } from '../services/voiceAssistant/manager.js';
import { getConfig, loadVoicePreference, voiceMetrics } from '../services/voiceAssistant/runtime.js';
import { isValidAssistantToken } from '../services/voiceAssistant/recallIntegration.js';
import type { RecallTranscriptWebhookPayload } from '../types/meetings.js';

export const voiceAssistantWebhookRouter = Router();

voiceAssistantWebhookRouter.post('/', async (req: Request, res: Response) => {
  const token = typeof req.query.vt === 'string' ? req.query.vt : undefined;
  const tokenOk = isValidAssistantToken(token, config.INTERNAL_SECRET);
  const sigOk = !tokenOk && verifyRecallWebhook({
    rawBody: (req as Request & { rawBody?: Buffer }).rawBody,
    headers: req.headers,
    secrets: [config.RECALL_WEBHOOK_SECRET, config.RECALL_VERIFICATION_SECRET],
  }).ok;
  if (!tokenOk && !sigOk) {
    reportAlert('voice_assistant', 'WEBHOOK_UNAUTHORIZED', {}, 3_600_000);
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const result = await getVoiceAssistantManager().handle(req.body as RecallTranscriptWebhookPayload);
    res.json({ ok: true, handled: result.handled });
  } catch (err) {
    // 200 on purpose: a retry storm from Recall would only replay old utterances.
    console.error('[VoiceAssistant] webhook error:', (err as Error)?.message);
    res.json({ ok: false });
  }
});

export const voiceAssistantInternalRouter = Router();

voiceAssistantInternalRouter.get('/rollup', asyncHandler(async (req: Request, res: Response) => {
  const secret = config.INTERNAL_SECRET;
  const provided = req.headers['x-internal-secret'];
  const given = Array.isArray(provided) ? provided[0] : provided;
  const ok = !!secret && !!given && Buffer.byteLength(given) === Buffer.byteLength(secret) && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) { res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid internal secret' } }); return; }
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? '7'), 10) || 7, 1), 90);
  const cfg = getConfig();
  res.json({
    mode: cfg.mode, killed: cfg.killed,
    caps: { perMeeting: cfg.maxQuestionsPerMeeting, perUserPerDay: cfg.maxQuestionsPerUserPerDay, dailySpendUsd: cfg.dailySpendCapUsd },
    days: await voiceMetrics.rollup(days),
  });
}));

export const voiceAssistantUserRouter = Router();

voiceAssistantUserRouter.get('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const preference = await loadVoicePreference(userId);
  const d = decideEnabled(getConfig(), userId, preference);
  res.json({ enabled: d.enabled, reason: d.reason, preference: preference ?? null, mode: getConfig().mode });
}));

voiceAssistantUserRouter.put('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  const userId = req.user!.id;
  const { data: profile } = await supabaseAdmin.from('profiles').select('preferences').eq('id', userId).maybeSingle();
  const preferences = { ...((profile as { preferences?: Record<string, unknown> } | null)?.preferences ?? {}), voice_assistant: enabled };
  const { error } = await supabaseAdmin.from('profiles').update({ preferences }).eq('id', userId);
  if (error) throw Errors.internal('Failed to save preference');
  const d = decideEnabled(getConfig(), userId, enabled);
  res.json({ enabled: d.enabled, reason: d.reason, preference: enabled, mode: getConfig().mode });
}));
