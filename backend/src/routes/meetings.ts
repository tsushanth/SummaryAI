/**
 * Meetings Routes
 * CRUD operations for meetings and bot management
 */

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { RecallService, detectPlatform } from '../services/recallService.js';
import {
  scheduleBotJoin,
  cancelScheduledBot,
  markJobExecuted,
  markJobFailed,
} from '../services/botSchedulerService.js';
import { authenticate, internalAuth } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import {
  CreateManualMeetingSchema,
  UpdateMeetingSchema,
  ListMeetingsSchema,
  BotJoinWorkerSchema,
  InstantJoinSchema,
  MeetingListResponse,
  MeetingDetailResponse,
  BotRunResponse,
  Meeting,
  LiveTranscriptResponse,
  LiveInsightsResponse,
  LiveInsightType,
} from '../types/meetings.js';
import { getLiveInsights } from '../services/liveInsightsService.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/meetings
 * List meetings for the user
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const parsed = ListMeetingsSchema.safeParse(req.query);

    if (!parsed.success) {
      throw Errors.badRequest('Invalid request parameters');
    }

    const { limit, offset, status, days_ahead } = parsed.data;

    let query = supabaseAdmin
      .from('meetings')
      .select(
        'id, title, platform, source, scheduled_start, scheduled_end, auto_join, status, recording_id',
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
    } = parsed.data;

    // Detect platform from URL
    const platform = detectPlatform(join_url);

    // Create meeting
    const { data: meeting, error } = await supabaseAdmin
      .from('meetings')
      .insert({
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
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Schedule bot if auto_join is enabled
    if (auto_join) {
      try {
        await scheduleBotJoin(meeting.id, userId, scheduled_start, join_offset_minutes);
      } catch (scheduleError) {
        console.error('[Meetings] Failed to schedule bot:', scheduleError);
        // Revert status if scheduling fails
        await supabaseAdmin
          .from('meetings')
          .update({ status: 'scheduled', auto_join: false })
          .eq('id', meeting.id);
      }
    }

    console.log(`[Meetings] Created meeting ${meeting.id} for user ${userId}`);

    res.status(201).json({ meeting });
  })
);

/**
 * POST /api/meetings/join
 * Instantly join a meeting with a URL - creates meeting and dispatches bot immediately
 */
router.post(
  '/join',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const parsed = InstantJoinSchema.safeParse(req.body);

    if (!parsed.success) {
      throw Errors.badRequest('Invalid request body');
    }

    const { join_url, bot_name, title } = parsed.data;

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

    // Generate a title if not provided
    const meetingTitle = title || `${platform.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} Meeting`;

    // Create meeting with immediate start time
    const now = new Date().toISOString();
    const { data: meeting, error: createError } = await supabaseAdmin
      .from('meetings')
      .insert({
        user_id: userId,
        source: 'manual',
        title: meetingTitle,
        platform,
        join_url,
        scheduled_start: now,
        scheduled_end: null,
        auto_join: true,
        status: 'bot_joining',
      })
      .select()
      .single();

    if (createError) {
      console.error('[Meetings] Failed to create meeting:', createError);
      throw Errors.internal('Failed to create meeting');
    }

    try {
      // Create bot via Recall.ai immediately
      const bot = await RecallService.createBot({
        meeting_url: join_url,
        bot_name: bot_name || 'Meeting Mind',
      });

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
      await supabaseAdmin.from('bot_runs').insert({
        meeting_id: meeting.id,
        user_id: userId,
        recall_bot_id: bot.id,
        status: 'joining',
        join_requested_at: now,
      });

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

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('meetings')
      .update(updates)
      .eq('id', meetingId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    res.json({ meeting: updated });
  })
);

/**
 * POST /api/meetings/:id/join-now
 * Trigger immediate bot join
 */
router.post(
  '/:id/join-now',
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

    // Check if bot is already active
    if (['bot_joining', 'bot_in_meeting', 'completed'].includes(meeting.status)) {
      throw Errors.unprocessable('Bot is already active or meeting completed');
    }

    // Cancel any scheduled bot
    await cancelScheduledBot(meetingId);

    // Create bot via Recall.ai
    const bot = await RecallService.createBot({
      meeting_url: meeting.join_url,
      bot_name: 'Meeting Mind',
    });

    // Create bot run record
    await supabaseAdmin.from('bot_runs').insert({
      meeting_id: meetingId,
      user_id: userId,
      recall_bot_id: bot.id,
      status: 'joining',
      join_requested_at: new Date().toISOString(),
    });

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
 * GET /api/meetings/:id/live-transcript
 * Get live transcript segments for a meeting in progress
 */
router.get(
  '/:id/live-transcript',
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
 * GET /api/meetings/:id/live-insights
 * Get AI-generated insights for a meeting in progress
 */
router.get(
  '/:id/live-insights',
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

    try {
      // Create bot via Recall.ai
      const bot = await RecallService.createBot({
        meeting_url: meeting.join_url,
        bot_name: 'Meeting Mind',
      });

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
      await supabaseAdmin.from('bot_runs').insert({
        meeting_id: meetingId,
        user_id: userId,
        recall_bot_id: bot.id,
        status: 'joining',
        join_requested_at: new Date().toISOString(),
      });

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
