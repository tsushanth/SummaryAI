/**
 * Webhook Routes
 * Handles webhooks from external services (Recall.ai)
 * Recall.ai uses Svix for webhook delivery
 */

import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { RecallWebhookPayload, BotRun, Meeting } from '../types/meetings.js';
import { downloadAndStoreRecording } from '../services/recallService.js';
import { triggerProcessing } from '../services/processingService.js';

const router = Router();

/**
 * Helper to extract header value (handles string | string[] | undefined)
 */
function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Verify Recall.ai webhook signature
 * Note: Recall.ai webhook signing must be enabled in their dashboard
 * If Svix headers are present, verify with Svix. Otherwise, accept the webhook.
 */
function verifyRecallSignature(
  payload: string,
  headers: Record<string, string | string[] | undefined>
): boolean {
  const webhookSecret = config.RECALL_WEBHOOK_SECRET;

  // Extract Svix headers (Express lowercases all headers)
  const svixId = getHeader(headers, 'svix-id');
  const svixTimestamp = getHeader(headers, 'svix-timestamp');
  const svixSignature = getHeader(headers, 'svix-signature');

  // Log headers for debugging
  console.log('[Webhook] Incoming headers:', Object.keys(headers).filter(k => !k.startsWith('x-cloud') && !k.startsWith('x-forwarded')).join(', '));
  console.log('[Webhook] Svix headers present:', { svixId: !!svixId, svixTimestamp: !!svixTimestamp, svixSignature: !!svixSignature });

  // If no Svix headers are present, Recall.ai webhook signing may not be enabled
  // Accept the webhook but log a warning
  if (!svixId && !svixTimestamp && !svixSignature) {
    console.warn('[Webhook] No Svix headers found - webhook signing may not be enabled in Recall.ai dashboard');
    console.warn('[Webhook] Accepting webhook without signature verification (configure signing in production)');
    return true;
  }

  // If some Svix headers are present but not all, reject
  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error('[Webhook] Partial Svix headers - id:', !!svixId, 'timestamp:', !!svixTimestamp, 'signature:', !!svixSignature);
    return false;
  }

  // If no secret configured but headers are present, we can't verify
  if (!webhookSecret) {
    console.warn('[Webhook] RECALL_WEBHOOK_SECRET not set but Svix headers present, skipping verification');
    return true;
  }

  try {
    const wh = new Webhook(webhookSecret);
    const svixHeaders = {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    };
    wh.verify(payload, svixHeaders);
    console.log('[Webhook] Svix verification successful');
    return true;
  } catch (err) {
    console.error('[Webhook] Svix verification failed:', err);
    return false;
  }
}

/**
 * POST /webhooks/recall
 * Handle Recall.ai webhook events
 */
router.post('/recall', async (req: Request, res: Response) => {
  // Verify webhook signature using Svix headers
  const rawBody = JSON.stringify(req.body);
  const headers = req.headers;

  if (!verifyRecallSignature(rawBody, headers)) {
    console.error('[Webhook] Invalid Recall signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Log the raw payload to understand the structure
  console.log('[Webhook] Raw payload:', JSON.stringify(req.body).substring(0, 1000));

  const payload = req.body;

  // Recall.ai webhook payload structure - event is at root, data contains bot info
  const event = payload.event;
  const data = payload.data || {};

  // The bot_id might be at data.bot_id or data.bot.id depending on event type
  const botId = data.bot_id || (data.bot && data.bot.id) || data.id;

  console.log(`[Webhook] Recall event: ${event}, bot_id: ${botId}`);

  // If no bot_id found, log the full data structure for debugging
  if (!botId) {
    console.error('[Webhook] Could not extract bot_id from payload. Data keys:', Object.keys(data));
    res.status(400).json({ error: 'Missing bot_id in webhook payload' });
    return;
  }

  try {
    // Get bot run by recall_bot_id
    const { data: botRun, error: botError } = await supabaseAdmin
      .from('bot_runs')
      .select('*')
      .eq('recall_bot_id', botId)
      .single();

    if (botError || !botRun) {
      console.error(`[Webhook] Bot run not found for Recall bot ${botId}`);
      res.status(404).json({ error: 'Bot run not found' });
      return;
    }

    // Get associated meeting
    const { data: meeting, error: meetingError } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('id', botRun.meeting_id)
      .single();

    if (meetingError || !meeting) {
      console.error(`[Webhook] Meeting not found for bot run ${botRun.id}`);
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    // Handle different webhook events
    switch (event) {
      // Bot lifecycle events
      case 'bot.joining_call':
        await handleBotJoining(botRun, meeting);
        break;

      case 'bot.in_waiting_room':
        await handleBotInWaitingRoom(botRun);
        break;

      case 'bot.in_call_recording':
        await handleBotRecording(botRun, meeting);
        break;

      case 'bot.in_call_not_recording':
        await handleBotNotRecording(botRun, meeting);
        break;

      case 'bot.call_ended':
        await handleBotCallEnded(botRun, meeting);
        break;

      case 'bot.done':
        await handleBotDone(botRun);
        break;

      case 'bot.fatal':
        await handleBotFatal(botRun, meeting, data);
        break;

      case 'bot.recording_permission_allowed':
        console.log(`[Webhook] Recording permission allowed for bot ${botRun.id}`);
        break;

      case 'bot.recording_permission_denied':
        await handleRecordingPermissionDenied(botRun, meeting, data);
        break;

      // Recording/media events
      case 'recording.done':
      case 'audio_mixed.done':
        await handleRecordingDone(botRun, meeting, data);
        break;

      case 'recording.failed':
      case 'audio_mixed.failed':
        await markBotFailed(botRun, meeting, 'Recording failed');
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${event}`);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('[Webhook] Error processing Recall webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Handle bot.joining_call event
 */
async function handleBotJoining(
  botRun: BotRun,
  meeting: Meeting
): Promise<void> {
  console.log(`[Webhook] Bot ${botRun.id} is joining call`);

  await supabaseAdmin
    .from('bot_runs')
    .update({
      status: 'joining',
      recall_status: 'joining_call',
    })
    .eq('id', botRun.id);

  await supabaseAdmin
    .from('meetings')
    .update({ status: 'bot_joining' })
    .eq('id', meeting.id);
}

/**
 * Handle bot.in_waiting_room event
 */
async function handleBotInWaitingRoom(
  botRun: BotRun
): Promise<void> {
  console.log(`[Webhook] Bot ${botRun.id} is in waiting room`);

  await supabaseAdmin
    .from('bot_runs')
    .update({
      status: 'joining',
      recall_status: 'in_waiting_room',
    })
    .eq('id', botRun.id);
}

/**
 * Handle bot.in_call_recording event
 */
async function handleBotRecording(
  botRun: BotRun,
  meeting: Meeting
): Promise<void> {
  console.log(`[Webhook] Bot ${botRun.id} is recording`);

  await supabaseAdmin
    .from('bot_runs')
    .update({
      status: 'recording',
      recall_status: 'in_call_recording',
      joined_at: botRun.joined_at || new Date().toISOString(),
    })
    .eq('id', botRun.id);

  await supabaseAdmin
    .from('meetings')
    .update({ status: 'bot_in_meeting' })
    .eq('id', meeting.id);
}

/**
 * Handle bot.in_call_not_recording event
 */
async function handleBotNotRecording(
  botRun: BotRun,
  meeting: Meeting
): Promise<void> {
  console.log(`[Webhook] Bot ${botRun.id} is in call but not recording`);

  await supabaseAdmin
    .from('bot_runs')
    .update({
      status: 'in_call',
      recall_status: 'in_call_not_recording',
      joined_at: botRun.joined_at || new Date().toISOString(),
    })
    .eq('id', botRun.id);

  await supabaseAdmin
    .from('meetings')
    .update({ status: 'bot_in_meeting' })
    .eq('id', meeting.id);
}

/**
 * Handle bot.call_ended event
 */
async function handleBotCallEnded(
  botRun: BotRun,
  meeting: Meeting
): Promise<void> {
  console.log(`[Webhook] Bot ${botRun.id} call ended`);

  await supabaseAdmin
    .from('bot_runs')
    .update({
      status: 'processing',
      recall_status: 'call_ended',
      left_at: new Date().toISOString(),
    })
    .eq('id', botRun.id);

  await supabaseAdmin
    .from('meetings')
    .update({ status: 'bot_left' })
    .eq('id', meeting.id);
}

/**
 * Handle bot.done event (bot has shut down)
 */
async function handleBotDone(
  botRun: BotRun
): Promise<void> {
  console.log(`[Webhook] Bot ${botRun.id} has shut down (bot.done)`);

  // Only update if not already completed or failed
  if (botRun.status !== 'completed' && botRun.status !== 'failed') {
    await supabaseAdmin
      .from('bot_runs')
      .update({
        status: 'processing',
        recall_status: 'done',
        left_at: botRun.left_at || new Date().toISOString(),
      })
      .eq('id', botRun.id);
  }
}

/**
 * Handle bot.fatal event
 */
async function handleBotFatal(
  botRun: BotRun,
  meeting: Meeting,
  data: RecallWebhookPayload['data']
): Promise<void> {
  const errorMessage = data.sub_code || data.message || 'Bot encountered a fatal error';
  console.error(`[Webhook] Bot ${botRun.id} fatal error: ${errorMessage}`);

  await supabaseAdmin
    .from('bot_runs')
    .update({
      status: 'failed',
      recall_status: 'fatal',
      error_code: data.sub_code,
      error_message: errorMessage,
    })
    .eq('id', botRun.id);

  await supabaseAdmin
    .from('meetings')
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('id', meeting.id);
}

/**
 * Handle recording permission denied
 */
async function handleRecordingPermissionDenied(
  botRun: BotRun,
  meeting: Meeting,
  data: RecallWebhookPayload['data']
): Promise<void> {
  const errorMessage = data.sub_code || 'Recording permission denied by host';
  console.error(`[Webhook] Bot ${botRun.id} recording permission denied: ${errorMessage}`);

  await supabaseAdmin
    .from('bot_runs')
    .update({
      status: 'failed',
      error_code: 'recording_permission_denied',
      error_message: errorMessage,
    })
    .eq('id', botRun.id);

  await supabaseAdmin
    .from('meetings')
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('id', meeting.id);
}

/**
 * Handle recording.done or audio_mixed.done event
 */
async function handleRecordingDone(
  botRun: BotRun,
  meeting: Meeting,
  data: RecallWebhookPayload['data']
): Promise<void> {
  console.log(`[Webhook] Recording done for bot ${botRun.id}, fetching media URL...`);

  try {
    // Fetch the bot details from Recall.ai to get the recording URL
    const recallApiKey = config.RECALL_API_KEY;
    const recallRegion = config.RECALL_REGION || 'us-west-2';
    const baseUrl = `https://${recallRegion}.recall.ai/api/v1`;

    const response = await fetch(`${baseUrl}/bot/${botRun.recall_bot_id}`, {
      headers: {
        'Authorization': `Token ${recallApiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch bot details: ${response.status}`);
    }

    const botDetails = await response.json() as {
      video_url?: string;
      recordings?: Array<{
        media_shortcuts?: {
          video_mixed?: { data?: { download_url?: string } };
          audio?: { data?: { download_url?: string } };
          audio_mixed?: { data?: { download_url?: string } };
          transcript?: { data?: { download_url?: string } };
        };
      }>;
    };

    // Log the bot details for debugging
    console.log(`[Webhook] Bot details - video_url: ${!!botDetails.video_url}, recordings: ${botDetails.recordings?.length || 0}`);

    // Try to get media URL from various sources
    let mediaUrl = botDetails.video_url;

    if (botDetails.recordings && botDetails.recordings.length > 0) {
      const recording = botDetails.recordings[0];
      const shortcuts = recording?.media_shortcuts;

      // Try different media sources in order of preference
      if (shortcuts?.video_mixed?.data?.download_url) {
        mediaUrl = shortcuts.video_mixed.data.download_url;
        console.log('[Webhook] Using video_mixed URL');
      } else if (shortcuts?.audio_mixed?.data?.download_url) {
        mediaUrl = shortcuts.audio_mixed.data.download_url;
        console.log('[Webhook] Using audio_mixed URL');
      } else if (shortcuts?.audio?.data?.download_url) {
        mediaUrl = shortcuts.audio.data.download_url;
        console.log('[Webhook] Using audio URL');
      }

      // Log available shortcuts for debugging
      console.log(`[Webhook] Available shortcuts: ${Object.keys(shortcuts || {}).join(', ')}`);
    }

    if (!mediaUrl) {
      console.error('[Webhook] No media URL found in bot details. Bot response structure:', JSON.stringify(botDetails).substring(0, 500));
      await markBotFailed(botRun, meeting, 'No recording URL available');
      return;
    }

    console.log(`[Webhook] Got media URL for bot ${botRun.id}`);

    // Download recording from Recall and upload to Supabase Storage
    const { storagePath, durationSeconds } = await downloadAndStoreRecording(
      mediaUrl,
      meeting.user_id,
      meeting.id
    );

    // Use duration from webhook if available
    const finalDuration = data.duration_seconds || durationSeconds;

    // Create recording record
    const { data: recording, error: recordingError } = await supabaseAdmin
      .from('recordings')
      .insert({
        user_id: meeting.user_id,
        title: meeting.title,
        file_path: storagePath,
        duration_seconds: finalDuration,
        status: 'uploaded',
        source: 'meeting_bot',
      })
      .select()
      .single();

    if (recordingError || !recording) {
      throw new Error(`Failed to create recording: ${recordingError?.message}`);
    }

    console.log(`[Webhook] Created recording ${recording.id} for meeting ${meeting.id}`);

    // Update bot run with recording info
    await supabaseAdmin
      .from('bot_runs')
      .update({
        status: 'completed',
        recording_url: mediaUrl,
        duration_seconds: finalDuration,
      })
      .eq('id', botRun.id);

    // Update meeting with recording link
    await supabaseAdmin
      .from('meetings')
      .update({
        status: 'completed',
        recording_id: recording.id,
      })
      .eq('id', meeting.id);

    // Trigger transcription and summarization pipeline
    await triggerProcessing(recording.id, meeting.user_id);

    console.log(`[Webhook] Triggered processing for recording ${recording.id}`);
  } catch (error) {
    console.error('[Webhook] Error processing recording:', error);
    await markBotFailed(
      botRun,
      meeting,
      error instanceof Error ? error.message : 'Failed to process recording'
    );
  }
}

/**
 * Mark bot run and meeting as failed
 */
async function markBotFailed(
  botRun: BotRun,
  meeting: Meeting,
  errorMessage: string
): Promise<void> {
  await supabaseAdmin
    .from('bot_runs')
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('id', botRun.id);

  await supabaseAdmin
    .from('meetings')
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('id', meeting.id);
}

export default router;
