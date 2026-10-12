/**
 * Public share links (slice C).
 *
 * Owner routes (auth required), mounted at /api/recordings/:id/shares:
 *   POST   /            create link  -> { share, token, url }  (token is shown ONCE; only its hash is stored)
 *   GET    /            list shares for the recording (no tokens)
 *   DELETE /:shareId    revoke (takes effect immediately; every public read re-checks the DB)
 *
 * Public route (NO auth), mounted at /api/public/shares:
 *   GET /:token         read-only view. Unknown, malformed, revoked and expired
 *                       tokens all return the same 404 so nothing can be probed.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import {
  SHARE_TOKEN_REGEX,
  generateShareToken,
  hashShareToken,
  createRateLimiter,
} from '../lib/shareToken.js';

export const recordingSharesRouter = Router({ mergeParams: true });
export const publicSharesRouter = Router();

const idSchema = z.string().uuid();

const createShareSchema = z.object({
  include_transcript: z.boolean().optional().default(false),
  /** null / omitted = never expires */
  expires_in_days: z.number().int().min(1).max(365).nullable().optional(),
});

const SHARE_COLUMNS = 'id, recording_id, include_transcript, expires_at, revoked_at, view_count, last_viewed_at, created_at';

// ----------------------------------------------------------------------------
// Owner routes
// ----------------------------------------------------------------------------

async function requireOwnedRecording(userId: string, recordingId: string): Promise<void> {
  if (!idSchema.safeParse(recordingId).success) throw Errors.notFound('Recording');
  const { data } = await supabaseAdmin
    .from('recordings')
    .select('id')
    .eq('id', recordingId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw Errors.notFound('Recording');
}

recordingSharesRouter.post(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const recordingId = req.params.id;
    const body = createShareSchema.parse(req.body || {});
    await requireOwnedRecording(userId, recordingId);

    const token = generateShareToken();
    const expiresAt = body.expires_in_days
      ? new Date(Date.now() + body.expires_in_days * 86400_000).toISOString()
      : null;

    const { data: share, error } = await supabaseAdmin
      .from('recording_shares')
      .insert({
        recording_id: recordingId,
        user_id: userId,
        token_hash: hashShareToken(token),
        include_transcript: body.include_transcript,
        expires_at: expiresAt,
      })
      .select(SHARE_COLUMNS)
      .single();

    if (error || !share) {
      console.error('Failed to create share:', error);
      throw Errors.internal('Failed to create share link');
    }

    const base = config.WEB_APP_URL.replace(/\/+$/, '');
    res.status(201).json({ share, token, url: `${base}/share/${token}` });
  })
);

recordingSharesRouter.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const recordingId = req.params.id;
    await requireOwnedRecording(userId, recordingId);

    const { data, error } = await supabaseAdmin
      .from('recording_shares')
      .select(SHARE_COLUMNS)
      .eq('recording_id', recordingId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw Errors.internal('Failed to fetch share links');

    res.json({ shares: data || [] });
  })
);

recordingSharesRouter.delete(
  '/:shareId',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const recordingId = req.params.id;
    if (!idSchema.safeParse(req.params.shareId).success) throw Errors.notFound('Share');

    const { data, error } = await supabaseAdmin
      .from('recording_shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', req.params.shareId)
      .eq('recording_id', recordingId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id');

    if (error) throw Errors.internal('Failed to revoke share link');
    if (!data || data.length === 0) throw Errors.notFound('Share');

    res.status(204).send();
  })
);

// ----------------------------------------------------------------------------
// Public route
// ----------------------------------------------------------------------------

// 60 requests/minute per client IP.
const publicLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

function notFound(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'This link is invalid or no longer available' } });
}

function actionItemText(item: any): string | null {
  if (typeof item === 'string') return item;
  return item?.text ?? item?.title ?? null;
}

publicSharesRouter.get(
  '/:token',
  publicLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const token = req.params.token;
    if (!SHARE_TOKEN_REGEX.test(token)) return notFound(res);

    const { data: share } = await supabaseAdmin
      .from('recording_shares')
      .select('id, recording_id, user_id, include_transcript, expires_at, revoked_at')
      .eq('token_hash', hashShareToken(token))
      .maybeSingle();

    if (!share || share.revoked_at) return notFound(res);
    if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) return notFound(res);

    // Defense in depth: the recording must still belong to the share's owner.
    const { data: recording } = await supabaseAdmin
      .from('recordings')
      .select('id, title, created_at, duration_seconds, language')
      .eq('id', share.recording_id)
      .eq('user_id', share.user_id)
      .maybeSingle();
    if (!recording) return notFound(res);

    const { data: summary } = await supabaseAdmin
      .from('summaries')
      .select('summary, key_points, action_items, topics')
      .eq('recording_id', share.recording_id)
      .maybeSingle();

    let transcript: any = null;
    if (share.include_transcript) {
      const { data: t } = await supabaseAdmin
        .from('transcripts')
        .select('segments, speaker_names')
        .eq('recording_id', share.recording_id)
        .maybeSingle();
      if (t) {
        const names: Record<string, string> = t.speaker_names || {};
        transcript = {
          segments: (Array.isArray(t.segments) ? t.segments : []).map((s: any) => ({
            speaker: names[String(s.speaker_index)] || s.speaker_label || `Speaker ${(s.speaker_index ?? 0) + 1}`,
            text: s.text ?? '',
            start_time: s.start_time ?? 0,
          })),
        };
      }
    }

    // Best-effort view counter; never block or fail the read.
    void Promise.resolve(supabaseAdmin.rpc('increment_share_view', { p_share_id: share.id })).catch(() => {});

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.json({
      recording: {
        title: recording.title,
        created_at: recording.created_at,
        duration_seconds: recording.duration_seconds,
        language: recording.language,
      },
      summary: summary
        ? {
            summary: summary.summary,
            key_points: summary.key_points || [],
            action_items: (summary.action_items || []).map(actionItemText).filter(Boolean),
            topics: summary.topics || [],
          }
        : null,
      transcript,
      expires_at: share.expires_at,
    });
  })
);
