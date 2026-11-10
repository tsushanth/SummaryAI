/**
 * Meetings Routes
 * CRUD operations for meetings and bot management
 */

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import {
  RecallService,
  detectPlatform,
  liveSttBotRunColumns,
  insertWithOptionalColumn,
  transcriptionLanguageColumns,
} from '../services/recallService.js';
import {
  ACTIVE_BOT_STATUSES,
  getLatestRunInfo,
  getUserDefaultLanguage,
  isMissingColumn,
  resolveBotLanguage,
  setUserDefaultLanguage,
} from '../services/meetingLanguage.js';
import { notifyLiveLanguage } from '../lib/liveSttControl.js';
import { liveSttEnvFrom, planLiveStt } from '../lib/liveStt.js';
import { liveStatusOf, parseFallbackState } from '../lib/liveSttFallback.js';
import { config } from '../config/index.js';
import { AUTO_LANGUAGE, TRANSCRIPTION_LANGUAGES, normalizeTranscriptionLanguage } from '../lib/transcriptionLanguage.js';
import {
  scheduleBotJoin,
  cancelScheduledBot,
  markJobExecuted,
  markJobFailed,
} from '../services/botSchedulerService.js';
import { authenticate, optionalAuth, internalAuth } from '../middleware/auth.js';
import { AppError, asyncHandler, Errors } from '../middleware/errorHandler.js';
import {
  CreateManualMeetingSchema,
  UpdateMeetingSchema,
  ListMeetingsSchema,
  BotJoinWorkerSchema,
  InstantJoinSchema,
  JoinNowSchema,
  LiveLanguageSchema,
  DefaultLanguageSchema,
  LiveLanguageState,
  MeetingListResponse,
  MeetingDetailResponse,
  BotRunResponse,
  Meeting,
  LiveTranscriptResponse,
  LiveInsightsResponse,
  LiveInsightType,
} from '../types/meetings.js';
import { getLiveInsights } from '../services/liveInsightsService.js';
import { enforceBotMonthlyCap, BOT_CAP_ERROR_CODE } from '../services/botUsageCap.js';

const router = Router();

/**
 * Insert a meetings row. If it carries transcription_language and migration 027 is not applied yet, the meeting is still created
 * (without the language) and `languageDropped` tells the caller.
 */
async function insertMeetingRow(row: Record<string, unknown>) {
  const run = (r: Record<string, unknown>) => supabaseAdmin.from('meetings').insert(r).select().single();
  let res = await run(row);
  let languageDropped = false;
  if (res.error && 'transcription_language' in row && isMissingColumn(res.error, 'transcription_language')) {
    const { transcription_language: _dropped, ...rest } = row;
    res = await run(rest);
    languageDropped = true;
  }
  return { ...res, languageDropped };
}

const LANGUAGE_NOT_SAVED_WARNING =
  'The transcription language could not be saved yet and will be ignored for this meeting. Auto-detect will be used.';

/**
 * GET /api/meetings/transcription-languages
 * The languages a meeting can be transcribed in, the caller's saved default, and what the live transcript can do right now.
 */
router.get(
  '/transcription-languages',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    // Per user (LIVE_STT_PROVIDER=auto can select some users and not others). Shadow is not passed on: it is not a user-facing path.
    const plan = planLiveStt({ ...liveSttEnvFrom(config as unknown as Record<string, unknown>), LIVE_STT_SHADOW: undefined }, req.user!.id);
    const soniox = plan.provider === 'soniox';
    res.json({
      auto: AUTO_LANGUAGE,
      default_language: await getUserDefaultLanguage(req.user!.id),
      languages: TRANSCRIPTION_LANGUAGES.map(({ code, name, native }) => ({ code, name, native })),
      live: {
        provider: soniox ? 'soniox' : 'recall',
        can_change_during_meeting: soniox,
        // Recall: only English is low latency. Any other language (or Recall's own detection) arrives 3-10 minutes late.
        english_only_low_latency: !soniox,
        non_english_live_delay_minutes: soniox ? null : '3-10',
        auto_live_behaviour: soniox ? 'detect' : config.RECALL_AUTO_LANGUAGE === 'detect' ? 'detect_delayed' : 'english_low_latency',
      },
    });
  })
);

/**
 * PUT /api/meetings/transcription-languages/default
 * Save the caller's default meeting language ('auto' removes it).
 */
router.put(
  '/transcription-languages/default',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = DefaultLanguageSchema.safeParse(req.body);
    if (!parsed.success) throw Errors.badRequest('Unsupported transcription language');
    try {
      await setUserDefaultLanguage(req.user!.id, parsed.data.language);
    } catch {
      throw Errors.internal('Failed to save default language');
    }
    res.json({ default_language: parsed.data.language });
  })
);

/**
 * GET /api/meetings
 * List meetings for the user
 * Allows guest access (returns empty list for unauthenticated users)
 */
router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    // Return empty list for guest users (not authenticated)
    if (!req.user) {
      const response: MeetingListResponse = {
        items: [],
        total: 0,
      };
      res.json(response);
      return;
    }

    const userId = req.user.id;
    const parsed = ListMeetingsSchema.safeParse(req.query);

    if (!parsed.success) {
      throw Errors.badRequest('Invalid request parameters');
    }

    const { limit, offset, status, days_ahead } = parsed.data;

    let query = supabaseAdmin
      .from('meetings')
      .select(
        'id, title, platform, source, scheduled_start, scheduled_end, auto_join, status, recording_id, join_url',
        { count: 'exact' }
      )
      .eq('user_id', userId);

    const now = new Date().toISOString();
    const futureDate = new Date(
      Date.now() + days_ahead * 24 * 60 * 60 * 1000
    ).toISOString();

    if (status === 'upcoming') {
      // Include meetings that:
      // 1. Start time is in the future (upcoming), OR
      // 2. Start time is in the past but end time is in the future (ongoing)
      // Since Supabase doesn't support OR conditions easily, we use a raw filter
      // We filter: (scheduled_start >= now AND scheduled_start <= futureDate) OR (scheduled_start < now AND scheduled_end > now)
      query = query
        .or(`and(scheduled_start.gte.${now},scheduled_start.lte.${futureDate}),and(scheduled_start.lt.${now},scheduled_end.gt.${now})`)
        .order('scheduled_start', { ascending: true });
    } else if (status === 'past') {
      query = query
        .lt('scheduled_start', now)
        .order('scheduled_start', { ascending: false });
    } else {
      query = query.order('scheduled_start', { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    const response: MeetingListResponse = {
      items: data || [],
      total: count || 0,
    };

    res.json(response);
  })
);

/**
 * POST /api/meetings
 * Create a manual meeting
 */
router.post(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const parsed = CreateManualMeetingSchema.safeParse(req.body);

    if (!parsed.success) {
      throw Errors.badRequest('Invalid request body');
    }

    const {
      title,
      join_url,
      scheduled_start,
      scheduled_end,
      auto_join,
      join_offset_minutes,
      transcription_language,
    } = parsed.data;

    // Detect platform from URL
    const platform = detectPlatform(join_url);

    // Create meeting. An explicit choice (including 'auto') is stored as given; nothing chosen stores nothing and follows the
    // owner's default when the bot joins.
    const { data: meeting, error, languageDropped } = await insertMeetingRow({
      user_id: userId,
      source: 'manual',
      title,
      platform,
      join_url,
      scheduled_start,
      scheduled_end: scheduled_end || null,
      auto_join,
      join_offset_minutes,
      status: auto_join ? 'bot_queued' : 'scheduled',
      ...(transcription_language ? { transcription_language } : {}),
    });

    if (error) {
      throw error;
    }

    // Schedule bot if auto_join is enabled
    let scheduleWarning: string | undefined;
    if (auto_join) {
      try {
        await scheduleBotJoin(meeting.id, userId, scheduled_start, join_offset_minutes);
      } catch (scheduleError) {
        console.error('[Meetings] Failed to schedule bot:', scheduleError);
        // Revert status if scheduling fails, but tell the caller instead of
        // silently leaving them with a toggle that looks off for no reason
        meeting.status = 'scheduled';
        meeting.auto_join = false;
        scheduleWarning =
          'Could not schedule auto-recording for this meeting. Auto-record has been turned off — please try enabling it again or contact support if this keeps happening.';
        await supabaseAdmin
          .from('meetings')
          .update({ status: 'scheduled', auto_join: false })
          .eq('id', meeting.id);
      }
    }

    console.log(`[Meetings] Created meeting ${meeting.id} for user ${userId}`);

    res.status(201).json({
      meeting,
      warning: scheduleWarning ?? (languageDropped ? LANGUAGE_NOT_SAVED_WARNING : undefined),
    });
  })
);

/**
 * POST /api/meetings/join
 * Instantly join a meeting with a URL - creates meeting and dispatches bot immediately
 */
router.post(
  '/join',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const parsed = InstantJoinSchema.safeParse(req.body);

    if (!parsed.success) {
      throw Errors.badRequest('Invalid request body');
    }

    const { join_url, bot_name, title } = parsed.data;
    const language = await resolveBotLanguage({ explicit: parsed.data.transcription_language, userId });

    // Detect platform from URL
    const platform = detectPlatform(join_url);

    if (platform === 'unknown') {
      throw Errors.badRequest('Unsupported meeting platform. Please use Zoom, Teams, Google Meet, or other supported platforms.');
    }

    // Check if there's already an active meeting with the same URL for this user
    const { data: existingMeetings } = await supabaseAdmin
      .from('meetings')
      .select('id, title, platform, status, recording_id, join_url')
      .eq('user_id', userId)
      .eq('join_url', join_url)
      .in('status', ['bot_joining', 'bot_in_meeting', 'in_progress']);

    if (existingMeetings && existingMeetings.length > 0) {
      const existing = existingMeetings[0];
      console.log(`[Meetings] User ${userId} already has an active meeting for this URL: ${existing.id}`);

      // Return the existing meeting instead of creating a duplicate
      res.status(200).json({
        meeting: {
          id: existing.id,
          title: existing.title,
          platform: existing.platform,
          status: existing.status,
          join_url: existing.join_url,
          recording_id: existing.recording_id,
        },
        recording_id: existing.recording_id,
        already_exists: true,
      });
      return;
    }

    // Monthly bot allowance. Checked before anything is created so a refused request leaves no meeting row behind.
    const botLimits = await enforceBotMonthlyCap(userId);

    // Generate a title if not provided
    const meetingTitle = title || `${platform.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} Meeting`;

    // Create meeting with immediate start time
    const now = new Date().toISOString();
    const { data: meeting, error: createError } = await insertMeetingRow({
      user_id: userId,
      source: 'manual',
      title: meetingTitle,
      platform,
      join_url,
      scheduled_start: now,
      scheduled_end: null,
      auto_join: true,
      status: 'bot_joining',
      ...transcriptionLanguageColumns(language),
    });

    if (createError) {
      console.error('[Meetings] Failed to create meeting:', createError);
      throw Errors.internal('Failed to create meeting');
    }

    try {
      // Create bot via Recall.ai immediately
      const bot = await RecallService.createBot({
        user_id: userId,
        meeting_url: join_url,
        bot_name: bot_name || 'Meeting Mind',
        transcription_language: language,
      }, botLimits);

      // Create a pending recording so it shows up in recordings list immediately
      const { data: pendingRecording, error: recordingError } = await supabaseAdmin
        .from('recordings')
        .insert({
          user_id: userId,
          title: meetingTitle,
          status: 'pending',
          source: 'meeting_bot',
          meeting_id: meeting.id,
        })
        .select()
        .single();

      if (recordingError) {
        console.error('[Meetings] Failed to create pending recording:', recordingError);
      } else {
        // Link the pending recording to the meeting
        await supabaseAdmin
          .from('meetings')
          .update({ recording_id: pendingRecording.id })
          .eq('id', meeting.id);
      }

      // Create bot run record
      await insertWithOptionalColumn(supabaseAdmin.from('bot_runs'), {
        meeting_id: meeting.id,
        user_id: userId,
        recall_bot_id: bot.id,
        ...liveSttBotRunColumns(bot),
        ...transcriptionLanguageColumns(language),
        status: 'joining',
        join_requested_at: now,
      }, 'transcription_language');

      console.log(`[Meetings] Instant join: created meeting ${meeting.id} with bot ${bot.id}, pending recording ${pendingRecording?.id}`);

      res.status(201).json({
        meeting: {
          id: meeting.id,
          title: meeting.title,
          platform: meeting.platform,
          status: meeting.status,
          join_url: meeting.join_url,
          recording_id: pendingRecording?.id || null,
        },
        bot_id: bot.id,
        recording_id: pendingRecording?.id || null,
      });
    } catch (botError) {
      console.error('[Meetings] Failed to create bot:', botError);

      // Update meeting status to failed
      await supabaseAdmin
        .from('meetings')
        .update({
          status: 'failed',
          error_message: botError instanceof Error ? botError.message : 'Failed to start bot',
        })
        .eq('id', meeting.id);

      // A guardrail refusal (backend/LIVE_STT.md "Guardrails") keeps its own code and message.
      if (botError instanceof AppError) throw botError;
      throw Errors.internal('Failed to dispatch bot to meeting');
    }
  })
);

/**
 * GET /api/meetings/:id
 * Get meeting details
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const meetingId = req.params.id;

    const { data: meeting, error } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single();

    if (error || !meeting) {
      throw Errors.notFound('Meeting');
    }

    // Get latest bot run if exists
    const { data: botRun } = await supabaseAdmin
      .from('bot_runs')
      .select('id, status, joined_at, left_at, duration_seconds, error_message')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const botRunResponse: BotRunResponse | null = botRun
      ? {
          id: botRun.id,
          status: botRun.status,
          joined_at: botRun.joined_at,
          left_at: botRun.left_at,
          duration_seconds: botRun.duration_seconds,
          error_message: botRun.error_message,
        }
      : null;

    const runInfo = await getLatestRunInfo(meetingId);
    const language = runInfo
      ? normalizeTranscriptionLanguage(runInfo.transcription_language) ?? AUTO_LANGUAGE
      : normalizeTranscriptionLanguage(meeting.transcription_language) ?? AUTO_LANGUAGE;
    const active = !!runInfo && ACTIVE_BOT_STATUSES.includes(runInfo.status);
    const runProvider = runInfo?.live_stt_provider ?? 'recall';
    const liveLanguage: LiveLanguageState = {
      language,
      can_change: active && runProvider === 'soniox',
      reason: !active ? 'not_live' : runProvider === 'soniox' ? null : 'provider_fixed',
      provider: runProvider,
    };

    // Only for Soniox-primary runs: whether the live transcript is fine, was replaced by Recall's, or is unavailable (the final
    // transcript still comes after the meeting).
    const liveState = runProvider === 'soniox' ? parseFallbackState(runInfo?.live_stt_fallback) : null;

    const response: MeetingDetailResponse = {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      platform: meeting.platform,
      join_url: meeting.join_url,
      source: meeting.source,
      scheduled_start: meeting.scheduled_start,
      scheduled_end: meeting.scheduled_end,
      timezone: meeting.timezone,
      auto_join: meeting.auto_join,
      join_offset_minutes: meeting.join_offset_minutes,
      status: meeting.status,
      recording_id: meeting.recording_id,
      bot_run: botRunResponse,
      error_message: meeting.error_message,
      created_at: meeting.created_at,
      transcription_language: language,
      live_language: liveLanguage,
      ...(liveState ? { live_transcript: { status: liveStatusOf(liveState), reason: liveState.reason, switched_at_sec: liveState.switched_at_sec } } : {}),
    };

    res.json(response);
  })
);

/**
 * PATCH /api/meetings/:id
 * Update meeting
 */
router.patch(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const meetingId = req.params.id;
    const parsed = UpdateMeetingSchema.safeParse(req.body);

    if (!parsed.success) {
      throw Errors.badRequest('Invalid request body');
    }

    // Get current meeting
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !current) {
      throw Errors.notFound('Meeting');
    }

    const updates: Partial<Meeting> = { ...parsed.data };

    // Handle auto_join toggle
    if (
      updates.auto_join !== undefined &&
      updates.auto_join !== current.auto_join
    ) {
      if (updates.auto_join) {
        // Check if there's already an active bot for this meeting
        const { data: existingBotRuns } = await supabaseAdmin
          .from('bot_runs')
          .select('id, status, recall_bot_id')
          .eq('meeting_id', meetingId)
          .in('status', ['pending', 'joining', 'in_call', 'recording']);

        if (existingBotRuns && existingBotRuns.length > 0) {
          console.log(`[Meetings] Meeting ${meetingId} already has active bot(s), not scheduling another`);
          // Just update auto_join flag, don't schedule new bot
          updates.status = current.status;
        } else {
          // Enable: schedule bot
          try {
            await scheduleBotJoin(
              meetingId,
              userId,
              current.scheduled_start,
              updates.join_offset_minutes || current.join_offset_minutes
            );
            updates.status = 'bot_queued';
          } catch (scheduleError) {
            console.error('[Meetings] Failed to schedule bot:', scheduleError);
            throw Errors.internal('Failed to schedule bot');
          }
        }
      } else {
        // Disable: cancel scheduled bot
        await cancelScheduledBot(meetingId);
        updates.status = 'scheduled';
      }
    }

    let languageDropped = false;
    const doUpdate = (u: Partial<Meeting>) =>
      supabaseAdmin.from('meetings').update(u).eq('id', meetingId).eq('user_id', userId).select().single();
    let { data: updated, error: updateError } = await doUpdate(updates);
    if (updateError && 'transcription_language' in updates && isMissingColumn(updateError, 'transcription_language')) {
      const { transcription_language: _dropped, ...rest } = updates;
      languageDropped = true;
      ({ data: updated, error: updateError } = await doUpdate(rest));
    }

    if (updateError) {
      throw updateError;
    }

    res.json({ meeting: updated, ...(languageDropped ? { warning: LANGUAGE_NOT_SAVED_WARNING } : {}) });
  })
);

/**
 * POST /api/meetings/:id/join-now
 * Trigger immediate bot join
 */
router.post(
  '/:id/join-now',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const meetingId = req.params.id;
    const joinNow = JoinNowSchema.safeParse(req.body ?? {});
    if (!joinNow.success) throw Errors.badRequest('Unsupported transcription language');

    const { data: meeting, error: fetchError } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !meeting) {
      throw Errors.notFound('Meeting');
    }

    // Check if bot is already active
    if (['bot_joining', 'bot_in_meeting', 'completed'].includes(meeting.status)) {
      throw Errors.unprocessable('Bot is already active or meeting completed');
    }

    // Monthly bot allowance (before the scheduled bot is cancelled, so a refused request changes nothing).
    const botLimits = await enforceBotMonthlyCap(userId);

    // Cancel any scheduled bot
    await cancelScheduledBot(meetingId);

    const language = await resolveBotLanguage({
      explicit: joinNow.data.transcription_language,
      meetingValue: meeting.transcription_language,
      userId,
    });

    // Create bot via Recall.ai
    const bot = await RecallService.createBot({
      user_id: userId,
      meeting_url: meeting.join_url,
      bot_name: 'Meeting Mind',
      transcription_language: language,
    }, botLimits);

    // Create bot run record
    await insertWithOptionalColumn(supabaseAdmin.from('bot_runs'), {
      meeting_id: meetingId,
      user_id: userId,
      recall_bot_id: bot.id,
      ...liveSttBotRunColumns(bot),
      ...transcriptionLanguageColumns(language),
      status: 'joining',
      join_requested_at: new Date().toISOString(),
    }, 'transcription_language');

    // Update meeting status
    await supabaseAdmin
      .from('meetings')
      .update({ status: 'bot_joining' })
      .eq('id', meetingId);

    console.log(`[Meetings] Started bot ${bot.id} for meeting ${meetingId}`);

    res.json({ ok: true, bot_id: bot.id });
  })
);

/**
 * POST /api/meetings/:id/live-language  { language: 'auto' | code }
 * Change the live transcript's language while the bot is in the meeting.
 *  - Soniox live path: saves the choice (used by the final transcript too) and tells mm-live-stt to reopen the stream with the new
 *    hints; the service replays the last seconds of buffered audio so nothing is lost.
 *  - Recall transcript path (today's default): 409 LIVE_LANGUAGE_FIXED. Recall's recallai_streaming language is fixed when the bot
 *    is created and Recall documents no way to change it afterwards.
 */
router.post(
  '/:id/live-language',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const meetingId = req.params.id;
    const parsed = LiveLanguageSchema.safeParse(req.body);
    if (!parsed.success) throw Errors.badRequest('Unsupported transcription language');
    const language = parsed.data.language;

    const { data: meeting } = await supabaseAdmin
      .from('meetings')
      .select('id')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single();
    if (!meeting) throw Errors.notFound('Meeting');

    const run = await getLatestRunInfo(meetingId, { activeOnly: true });
    if (!run) {
      throw new AppError(409, 'MEETING_NOT_LIVE', 'The meeting is not being recorded right now, so the live language cannot be changed.');
    }
    if (run.live_stt_provider !== 'soniox' || !run.live_stt_ref) {
      throw new AppError(
        409,
        'LIVE_LANGUAGE_FIXED',
        'The live transcript language cannot be changed during a meeting. It was set when the bot joined. The final transcript still detects the language automatically.',
        { language: normalizeTranscriptionLanguage(run.transcription_language) ?? AUTO_LANGUAGE }
      );
    }

    // Persist first (the final transcript uses it too), tolerating a database without migration 027.
    const stored = transcriptionLanguageColumns(language).transcription_language ?? null;
    for (const [table, id, value] of [['bot_runs', run.id, stored], ['meetings', meetingId, language]] as const) {
      const { error } = await supabaseAdmin.from(table).update({ transcription_language: value }).eq('id', id);
      if (error && !isMissingColumn(error, 'transcription_language')) throw Errors.internal('Failed to save the language');
    }

    const result = await notifyLiveLanguage(run.live_stt_ref, language);
    if (!result.ok) {
      console.warn(`[Meetings] live language change not delivered (${result.reason})`);
      res.json({
        ok: true,
        language,
        live_applied: false,
        message: 'Saved for the final transcript, but the live transcript could not be switched right now.',
      });
      return;
    }
    res.json({ ok: true, language, live_applied: true, live_state: result.state });
  })
);

/**
 * GET /api/meetings/:id/live-transcript
 * Get live transcript segments for a meeting in progress
 */
router.get(
  '/:id/live-transcript',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const meetingId = req.params.id;
    const since = req.query.since as string | undefined;

    // Verify meeting ownership
    const { data: meeting, error: meetingError } = await supabaseAdmin
      .from('meetings')
      .select('id')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single();

    if (meetingError || !meeting) {
      throw Errors.notFound('Meeting');
    }

    // Build query for live transcripts
    let query = supabaseAdmin
      .from('live_transcripts')
      .select('*')
      .eq('meeting_id', meetingId)
      .eq('is_partial', false) // Only return final transcripts by default
      .eq('shadow', false) // never show shadow-run (A/B comparison) rows
      .order('start_timestamp', { ascending: true });

    // Filter by timestamp if provided
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        query = query.gt('created_at', sinceDate.toISOString());
      }
    }

    // Limit results
    query = query.limit(100);

    const { data: segments, error: segmentsError } = await query;

    if (segmentsError) {
      console.error('[Meetings] Error fetching live transcripts:', segmentsError);
      throw Errors.internal('Failed to fetch live transcript');
    }

    const response: LiveTranscriptResponse = {
      segments: segments || [],
      has_more: (segments?.length || 0) >= 100,
    };

    res.json(response);
  })
);

/**
 * GET /api/meetings/:id/live-transcript/stitched
 *
 * Returns a single stitched plaintext + structured segments view of the live
 * transcript so far — shareable mid-meeting or before the post-processing
 * stitch runs. Same logic the StuckRecovery loop uses to write to `transcripts`.
 */
router.get(
  '/:id/live-transcript/stitched',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const meetingId = req.params.id;

    const { data: meeting, error: meetingError } = await supabaseAdmin
      .from('meetings')
      .select('id')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single();
    if (meetingError || !meeting) throw Errors.notFound('Meeting');

    const { fetchAllFinalizedSegments, stitchSegments } = await import('../services/stuckMeetingRecovery.js');
    const rows = await fetchAllFinalizedSegments(meetingId);
    const stitched = stitchSegments(rows);

    res.json({
      full_text: stitched.fullText,
      segments: stitched.segments,
      word_count: stitched.wordCount,
      speaker_count: stitched.speakerCount,
      duration_seconds: stitched.durationSec,
      source: 'recall_realtime', // unchanged field value for existing clients; the rows may come from the live-stt service
    });
  })
);

/**
 * GET /api/meetings/:id/live-insights
 * Get AI-generated insights for a meeting in progress
 */
router.get(
  '/:id/live-insights',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const meetingId = req.params.id;
    const type = req.query.type as LiveInsightType | undefined;

    // Verify meeting ownership
    const { data: meeting, error: meetingError } = await supabaseAdmin
      .from('meetings')
      .select('id')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single();

    if (meetingError || !meeting) {
      throw Errors.notFound('Meeting');
    }

    // Get insights using the service
    const insights = await getLiveInsights(meetingId, userId, type);

    const response: LiveInsightsResponse = {
      insights,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/meetings/:id
 * Cancel/delete meeting
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const meetingId = req.params.id;

    const { data: meeting, error: fetchError } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !meeting) {
      throw Errors.notFound('Meeting');
    }

    // Cancel any scheduled or active bot
    if (['bot_queued', 'bot_joining', 'bot_in_meeting'].includes(meeting.status)) {
      await cancelScheduledBot(meetingId);

      // Get active bot run and cancel via Recall.ai
      const { data: botRun } = await supabaseAdmin
        .from('bot_runs')
        .select('recall_bot_id')
        .eq('meeting_id', meetingId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (botRun?.recall_bot_id) {
        try {
          await RecallService.cancelBot(botRun.recall_bot_id);
        } catch (cancelError) {
          console.warn('[Meetings] Failed to cancel bot:', cancelError);
        }
      }
    }

    // Delete meeting (cascades to bot_runs and scheduler_jobs)
    const { error: deleteError } = await supabaseAdmin
      .from('meetings')
      .delete()
      .eq('id', meetingId)
      .eq('user_id', userId);

    if (deleteError) {
      throw deleteError;
    }

    console.log(`[Meetings] Deleted meeting ${meetingId}`);

    res.json({ ok: true });
  })
);

export default router;

/**
 * Internal Worker Router
 * Handles scheduled bot joins from Cloud Tasks
 */
export const meetingsWorkerRouter = Router();

/**
 * POST /internal/worker/bot-join
 * Internal endpoint called by Cloud Tasks to join a meeting
 */
meetingsWorkerRouter.post(
  '/bot-join',
  internalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = BotJoinWorkerSchema.safeParse(req.body);

    if (!parsed.success) {
      console.error('[Bot Worker] Invalid request:', parsed.error.issues);
      throw Errors.badRequest('Invalid request');
    }

    const { meetingId, userId } = parsed.data;

    console.log(`[Bot Worker] Processing bot join for meeting ${meetingId}`);

    // Get meeting
    const { data: meeting, error: fetchError } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .single();

    if (fetchError || !meeting) {
      console.error(`[Bot Worker] Meeting ${meetingId} not found`);
      await markJobFailed(meetingId, 'Meeting not found');
      throw Errors.notFound('Meeting');
    }

    // Check if meeting is still scheduled for bot
    if (!['scheduled', 'bot_queued'].includes(meeting.status)) {
      console.log(`[Bot Worker] Meeting ${meetingId} status is ${meeting.status}, skipping`);
      await markJobExecuted(meetingId);
      res.json({ ok: true, skipped: true });
      return;
    }

    // Check if there's already an active bot run for this meeting (prevent duplicates)
    const { data: existingBotRuns } = await supabaseAdmin
      .from('bot_runs')
      .select('id, status, recall_bot_id')
      .eq('meeting_id', meetingId)
      .in('status', ['pending', 'joining', 'in_call', 'recording']);

    if (existingBotRuns && existingBotRuns.length > 0) {
      console.log(`[Bot Worker] Meeting ${meetingId} already has ${existingBotRuns.length} active bot(s): ${existingBotRuns.map(b => b.recall_bot_id).join(', ')}, skipping`);
      await markJobExecuted(meetingId);
      res.json({ ok: true, skipped: true, reason: 'bot_already_active' });
      return;
    }

    // Monthly bot allowance. A scheduled join that is over the cap is closed out as failed with the reason (no retry: the cap
    // only resets next month) and answered 200 so the scheduler does not treat it as a transient error.
    let botLimits: { maxDurationSeconds?: number };
    try {
      botLimits = await enforceBotMonthlyCap(meeting.user_id ?? userId);
    } catch (capError) {
      if (!(capError instanceof AppError) || capError.code !== BOT_CAP_ERROR_CODE) throw capError;
      await markJobFailed(meetingId, capError.code);
      await supabaseAdmin
        .from('meetings')
        .update({ status: 'failed', error_message: capError.message })
        .eq('id', meetingId);
      res.json({ ok: true, skipped: true, reason: BOT_CAP_ERROR_CODE });
      return;
    }

    try {
      // Scheduled / calendar meetings: the meeting's own choice, else the owner's saved default, else auto.
      const language = await resolveBotLanguage({ meetingValue: meeting.transcription_language, userId });

      // Create bot via Recall.ai
      const bot = await RecallService.createBot({
        user_id: userId,
        meeting_url: meeting.join_url,
        bot_name: 'Meeting Mind',
        transcription_language: language,
      }, botLimits);

      // Create a pending recording so it shows up in recordings list immediately
      const { data: pendingRecording, error: recordingError } = await supabaseAdmin
        .from('recordings')
        .insert({
          user_id: userId,
          title: meeting.title,
          status: 'pending',
          source: 'meeting_bot',
          meeting_id: meetingId,
        })
        .select()
        .single();

      if (recordingError) {
        console.error('[Bot Worker] Failed to create pending recording:', recordingError);
      } else {
        console.log(`[Bot Worker] Created pending recording ${pendingRecording.id} for meeting ${meetingId}`);
      }

      // Create bot run record
      await insertWithOptionalColumn(supabaseAdmin.from('bot_runs'), {
        meeting_id: meetingId,
        user_id: userId,
        recall_bot_id: bot.id,
        ...liveSttBotRunColumns(bot),
        ...transcriptionLanguageColumns(language),
        status: 'joining',
        join_requested_at: new Date().toISOString(),
      }, 'transcription_language');

      // Update meeting status and link to pending recording
      await supabaseAdmin
        .from('meetings')
        .update({
          status: 'bot_joining',
          recording_id: pendingRecording?.id || null,
        })
        .eq('id', meetingId);

      // Mark scheduler job as executed
      await markJobExecuted(meetingId);

      console.log(`[Bot Worker] Started bot ${bot.id} for meeting ${meetingId}, pending recording ${pendingRecording?.id}`);

      res.json({ ok: true, bot_id: bot.id, recording_id: pendingRecording?.id || null });
    } catch (error) {
      console.error(`[Bot Worker] Error for meeting ${meetingId}:`, error);

      await markJobFailed(
        meetingId,
        error instanceof Error ? error.message : 'Unknown error'
      );

      // Update meeting status to failed
      await supabaseAdmin
        .from('meetings')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Failed to start bot',
        })
        .eq('id', meetingId);

      throw error;
    }
  })
);
