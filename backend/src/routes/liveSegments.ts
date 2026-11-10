/**
 * POST /internal/live-segments
 *
 * Sink for the separate live-stt service (live-stt/, PR #34): final transcript segments produced from Recall's raw audio by
 * Soniox. Writes `live_transcripts` rows in the same shape webhooks.ts writes for Recall's final segments, then calls the same
 * queueInsightGeneration path, so Android, web, live insights, coaching and Q&A are unchanged. See backend/LIVE_STT.md.
 *
 * Auth: `x-mm-signature: v1=hex(HMAC-SHA256(secret, "<x-mm-timestamp>.<raw body>"))`, timestamp within 5 minutes, constant-time
 * compare, any secret of LIVE_STT_SHARED_SECRET (comma separated for rotation). Unset secret = the route does not exist (404).
 * Privacy: bodies, segment text, speaker names, secrets and signatures are never logged or echoed back.
 *
 * Status codes (the service retries 5xx/429/408, drops the batch on any other 4xx):
 *   200 stored (also when every segment was a duplicate)   400 invalid schema   401 bad/missing/stale signature
 *   404 route disabled or unknown ref (permanent)          413 body too large   429 rate limited   500 retryable
 */
import express, { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { queueInsightGeneration } from '../services/liveInsightsService.js';
import { createRateLimiter } from '../lib/shareToken.js';
import { parseSecretList, verifyLiveSegments, signLiveSegments } from '../lib/liveStt.js';
import { loadVoiceAssistantConfig } from '../services/voiceAssistant/config.js';

export { signLiveSegments };

const TAG = '[LiveSegments]';
export const MAX_BODY_BYTES = 512 * 1024;
const MAX_SEGMENTS = 100;
const MAX_OFFSET_SEC = 48 * 3600;

/** Mount in index.ts BEFORE the global express.json(): the signature is over the exact bytes and the size cap must apply first. */
export const liveSegmentsBodyParser = express.raw({ type: () => true, limit: MAX_BODY_BYTES });

const rel = z.object({ relative: z.number().finite() }).strict();
const word = z.object({ text: z.string().max(200), start_timestamp: rel, end_timestamp: rel }).strict();

const segmentSchema = z
  .object({
    key: z.string().min(1).max(200),
    seq: z.number().int().min(0),
    segment_text: z.string().max(10_000).refine((s) => s.trim().length > 0),
    speaker_id: z.string().max(64),
    speaker_name: z.string().max(200),
    is_host: z.boolean(),
    start_timestamp: z.number().finite().min(0).max(MAX_OFFSET_SEC),
    end_timestamp: z.number().finite().min(0).max(MAX_OFFSET_SEC),
    words: z.array(word).max(2000),
    // Partials are never stored; the service only sends finals.
    is_partial: z.literal(false),
    is_final: z.literal(true).optional(),
    language: z.string().max(16).nullish(),
  })
  .strict()
  .refine((s) => s.end_timestamp >= s.start_timestamp);

const bodySchema = z
  .object({
    v: z.literal(1),
    botId: z.string().max(128).nullish(),
    ref: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    sessionId: z.string().min(1).max(128),
    segments: z.array(segmentSchema).min(1).max(MAX_SEGMENTS),
  })
  .strict()
  .refine((b) => new Set(b.segments.map((s) => s.key)).size === b.segments.length);

function intEnv(name: string, d: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export function liveSegmentsRouter(opts: { nowSec?: () => number } = {}): Router {
  const router = Router();
  const nowSec = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));

  // Cheap guard in front of the signature check (unsigned traffic must not cost HMAC + DB work). Generous: one meeting sends
  // about 1 request per 1-5 s, the service batches, and all meetings share one source IP.
  const ipLimiter = createRateLimiter({ windowMs: 60_000, max: intEnv('LIVE_STT_RATE_LIMIT_PER_MIN', 1200) });
  const refMax = intEnv('LIVE_STT_REF_RATE_LIMIT_PER_MIN', 240);
  const refHits = new Map<string, { count: number; resetAt: number }>();
  const refAllowed = (ref: string): { ok: boolean; retryAfter: number } => {
    const t = Date.now();
    if (refHits.size > 2000) for (const [k, v] of refHits) if (v.resetAt <= t) refHits.delete(k);
    let e = refHits.get(ref);
    if (!e || e.resetAt <= t) { e = { count: 0, resetAt: t + 60_000 }; refHits.set(ref, e); }
    e.count += 1;
    return { ok: e.count <= refMax, retryAfter: Math.max(1, Math.ceil((e.resetAt - t) / 1000)) };
  };

  router.post('/', ipLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const secrets = parseSecretList(process.env.LIVE_STT_SHARED_SECRET);
      if (secrets.length === 0) return fail(res, 404, 'NOT_FOUND', 'Endpoint not found');

      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const header = (n: string) => { const v = req.headers[n]; return Array.isArray(v) ? v[0] : v; };
      if (!verifyLiveSegments({ secrets, timestampSec: header('x-mm-timestamp'), signature: header('x-mm-signature'), rawBody: raw, nowSec: nowSec() })) {
        return fail(res, 401, 'UNAUTHORIZED', 'Invalid signature');
      }

      let json: unknown;
      try { json = JSON.parse(raw.toString('utf8')); } catch { return fail(res, 400, 'INVALID_BODY', 'Invalid body'); }
      const parsed = bodySchema.safeParse(json);
      if (!parsed.success) {
        // Paths and codes only: zod issues can carry received values, which may be transcript text.
        const why = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}:${i.code}`).join(',');
        console.warn(`${TAG} rejected body (${why})`);
        return fail(res, 400, 'INVALID_BODY', 'Invalid body');
      }
      const body = parsed.data;

      const budget = refAllowed(body.ref);
      if (!budget.ok) {
        res.setHeader('Retry-After', String(budget.retryAfter));
        return fail(res, 429, 'RATE_LIMITED', 'Too many requests');
      }

      // Look up by live_stt_ref, not recall_bot_id: recall_bot_id is only stored after Recall answers the create call.
      const { data: botRun, error: botError } = await supabaseAdmin
        .from('bot_runs')
        .select('id, meeting_id, user_id, live_stt_provider, recall_bot_id')
        .eq('live_stt_ref', body.ref)
        .maybeSingle();
      if (botError) {
        console.error(`${TAG} bot run lookup failed`);
        return fail(res, 500, 'INTERNAL', 'Lookup failed');
      }
      const provider = botRun?.live_stt_provider;
      if (!botRun || (provider !== 'soniox' && provider !== 'shadow')) {
        return fail(res, 404, 'UNKNOWN_REF', 'Unknown ref');
      }
      const shadow = provider === 'shadow';
      const ns = shadow ? 'shadow' : 'live';

      const rows = body.segments.map((s) => ({
        meeting_id: botRun.meeting_id,
        bot_run_id: botRun.id,
        user_id: botRun.user_id,
        segment_text: s.segment_text,
        speaker_id: s.speaker_id || null,
        speaker_name: s.speaker_name || null,
        is_host: s.is_host,
        start_timestamp: s.start_timestamp,
        end_timestamp: s.end_timestamp,
        words: s.words,
        is_partial: false,
        source_key: `${ns}:${body.ref}:${s.key}`,
        shadow,
      }));

      // ON CONFLICT (source_key) DO NOTHING: retries and replays never duplicate. `.select()` returns only the rows inserted.
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('live_transcripts')
        .upsert(rows, { onConflict: 'source_key', ignoreDuplicates: true })
        .select('id, source_key');
      if (insertError) {
        console.error(`${TAG} insert failed`);
        return fail(res, 500, 'INTERNAL', 'Failed to store segments');
      }
      const insertedCount = inserted?.length ?? 0;

      // Shadow rows never trigger insights (that would double the LLM spend and duplicate the user-visible insights).
      if (!shadow && insertedCount > 0) {
        try {
          await queueInsightGeneration(botRun.meeting_id, botRun.user_id);
        } catch {
          console.error(`${TAG} failed to queue insight generation`);
        }
      }

      // In-meeting voice assistant, only when it is told to take its wake phrase from this stream. Newly stored segments only (a
      // retried batch must not ask twice), never awaited (the assistant must not slow down or fail the sink), nothing logged.
      const recallBotId = (botRun as { recall_bot_id?: string | null }).recall_bot_id;
      if (insertedCount > 0 && recallBotId && loadVoiceAssistantConfig().wakeSource === 'live_stt') {
        const stored = new Set((inserted ?? []).map((r: { source_key?: string }) => r.source_key));
        const fresh = body.segments
          .filter((s) => stored.has(`${ns}:${body.ref}:${s.key}`))
          .sort((a, b) => a.seq - b.seq)
          .map((s) => ({ text: s.segment_text, speakerName: s.speaker_name || null, isHost: s.is_host }));
        void import('../services/voiceAssistant/manager.js')
          .then((m) => m.getVoiceAssistantManager().handleLive(recallBotId, fresh))
          .catch(() => console.error(`${TAG} voice assistant forward failed`));
      }

      console.log(`${TAG} ref=${body.ref.slice(0, 8)} shadow=${shadow} inserted=${insertedCount} duplicates=${rows.length - insertedCount}`);
      res.json({ ok: true, inserted: insertedCount, duplicates: rows.length - insertedCount });
    } catch {
      console.error(`${TAG} unexpected error`);
      if (!res.headersSent) fail(res, 500, 'INTERNAL', 'Internal error');
      else next();
    }
  });

  return router;
}
