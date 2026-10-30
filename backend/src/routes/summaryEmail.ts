/**
 * Email a recording's summary to people the owner types in.
 *
 *   POST /api/recordings/:id/email-summary   { recipients: string[], note?: string }
 *     -> { results: [{ email, status: 'sent' | 'failed' }] }
 *
 * One email per recipient (no shared To line), Reply-To the owner. Recipients are typed
 * by the owner, never read from calendar attendees (backend/DATA_SEGREGATION.md).
 * Every attempt is logged in summary_email_sends, which also drives the daily cap so
 * this cannot be used as a mail relay.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { reportAlert, reportProviderFailure } from '../lib/alerts.js';
import { sendEmail } from '../lib/email.js';
import { actionItemLine, renderSummaryEmail, summarySubject } from '../lib/summaryEmail.js';

export const summaryEmailRouter = Router({ mergeParams: true });

export const MAX_RECIPIENTS_PER_REQUEST = 10;
export const MAX_RECIPIENTS_PER_USER_PER_DAY = 50;

const idSchema = z.string().uuid();

const bodySchema = z.object({
  recipients: z
    .array(z.string().trim().toLowerCase().email().max(254))
    .min(1, 'Add at least one email address')
    .max(MAX_RECIPIENTS_PER_REQUEST, `At most ${MAX_RECIPIENTS_PER_REQUEST} recipients at a time`),
  note: z.string().trim().max(500).optional(),
});

summaryEmailRouter.post(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const senderEmail = req.user!.email;
    const recordingId = req.params.id;
    if (!idSchema.safeParse(recordingId).success) throw Errors.notFound('Recording');

    const body = bodySchema.parse(req.body || {});
    const recipients = [...new Set(body.recipients)];
    if (!senderEmail) throw Errors.badRequest('Your account has no email address to use as the reply-to');

    const { data: recording } = await supabaseAdmin
      .from('recordings')
      .select('id, title, created_at, duration_seconds')
      .eq('id', recordingId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!recording) throw Errors.notFound('Recording');

    const { data: summary } = await supabaseAdmin
      .from('summaries')
      .select('summary, key_points, action_items')
      .eq('recording_id', recordingId)
      .maybeSingle();
    if (!summary) throw Errors.unprocessable('This recording has no summary yet. Try again once processing finishes.');

    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count: usedToday } = await supabaseAdmin
      .from('summary_email_sends')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since);
    if ((usedToday ?? 0) + recipients.length > MAX_RECIPIENTS_PER_USER_PER_DAY) {
      throw Errors.badRequest(
        `Daily limit reached: at most ${MAX_RECIPIENTS_PER_USER_PER_DAY} summary emails per 24 hours.`
      );
    }

    const { html, text } = renderSummaryEmail({
      title: recording.title || 'Meeting',
      recordedAt: recording.created_at,
      durationSeconds: recording.duration_seconds,
      summary: summary.summary || '',
      keyPoints: Array.isArray(summary.key_points) ? summary.key_points.filter((k: unknown) => typeof k === 'string') : [],
      actionItems: (Array.isArray(summary.action_items) ? summary.action_items : [])
        .map(actionItemLine)
        .filter((a: string | null): a is string => !!a),
      note: body.note || undefined,
      senderEmail,
      webAppUrl: config.WEB_APP_URL,
    });
    const subject = summarySubject(recording.title || 'Meeting');

    const results = await Promise.all(
      recipients.map(async (email) => {
        try {
          await sendEmail({ app: 'meetingmind', to: email, subject, html, text, replyTo: senderEmail });
          return { email, status: 'sent' as const };
        } catch (err) {
          console.error(`[summary-email] send failed for recording ${recordingId}:`, err instanceof Error ? err.message : err);
          // The client only gets status 'failed' (HTTP 200), so without this nothing server-side signals it. A missing
          // RESEND_API_KEY or a rejected key is provider-wide; everything else is a per-send failure. No address, no title.
          if (err instanceof Error && /RESEND_API_KEY is not set/.test(err.message)) reportAlert('provider_unavailable', 'RESEND_KEY_MISSING', { provider: 'resend' });
          else reportProviderFailure('resend', err instanceof Error && /\b(401|403)\b|API key|restricted/i.test(err.message) ? { status: 401 } : err);
          return { email, status: 'failed' as const };
        }
      })
    );

    const { error: logError } = await supabaseAdmin.from('summary_email_sends').insert(
      results.map((r) => ({ recording_id: recordingId, user_id: userId, recipient_email: r.email, status: r.status }))
    );
    if (logError) {
      console.error('[summary-email] failed to log sends:', logError);
      // The daily per-user cap counts these rows, so a failing log write silently disables the cap.
      reportAlert('summary_email', 'SEND_LOG_WRITE_FAILED');
    }

    res.json({ results });
  })
);
