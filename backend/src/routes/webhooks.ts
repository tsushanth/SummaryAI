/**
 * Webhook Routes
 * Handles webhooks from external services (Recall.ai)
 * Recall.ai uses Svix for webhook delivery
 */

import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { twiml as TwiML } from 'twilio';
import Stripe from 'stripe';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { RecallWebhookPayload, BotRun, Meeting, RecallTranscriptWebhookPayload } from '../types/meetings.js';
import { downloadAndStoreRecording } from '../services/recallService.js';
import { triggerProcessing } from '../services/processingService.js';
import { queueInsightGeneration } from '../services/liveInsightsService.js';
import { grantCredits } from '../services/coachingService.js';
import { TwilioService } from '../services/twilioService.js';
import { alertWebhookFailure, alertPaymentFailure } from '../services/alertingService.js';

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

  // Update the pending recording status to 'uploading' (indicates recording in progress)
  if (meeting.recording_id) {
    await supabaseAdmin
      .from('recordings')
      .update({ status: 'uploading' })
      .eq('id', meeting.recording_id);
    console.log(`[Webhook] Updated recording ${meeting.recording_id} status to 'uploading' (recording in progress)`);
  }
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

  // Mark pending recording as failed if one exists
  if (meeting.recording_id) {
    await supabaseAdmin
      .from('recordings')
      .update({
        status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', meeting.recording_id);
    console.log(`[Webhook] Marked pending recording ${meeting.recording_id} as failed due to bot fatal error`);
  }
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

  // Mark pending recording as failed if one exists
  if (meeting.recording_id) {
    await supabaseAdmin
      .from('recordings')
      .update({
        status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', meeting.recording_id);
    console.log(`[Webhook] Marked pending recording ${meeting.recording_id} as failed due to recording permission denied`);
  }
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

    let recording;

    // Check if meeting already has a pending recording (created when user joined)
    if (meeting.recording_id) {
      // Update the existing pending recording
      const { data: existingRecording, error: updateError } = await supabaseAdmin
        .from('recordings')
        .update({
          file_path: storagePath,
          duration_seconds: finalDuration,
          status: 'uploaded',
        })
        .eq('id', meeting.recording_id)
        .select()
        .single();

      if (updateError) {
        console.error('[Webhook] Failed to update existing recording:', updateError);
        throw new Error(`Failed to update recording: ${updateError.message}`);
      }

      recording = existingRecording;
      console.log(`[Webhook] Updated existing recording ${recording.id} for meeting ${meeting.id}`);
    } else {
      // Create new recording record (fallback for meetings without pending recording)
      const { data: newRecording, error: recordingError } = await supabaseAdmin
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

      if (recordingError || !newRecording) {
        throw new Error(`Failed to create recording: ${recordingError?.message}`);
      }

      recording = newRecording;
      console.log(`[Webhook] Created new recording ${recording.id} for meeting ${meeting.id}`);
    }

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

  // Also mark the pending recording as failed if one exists
  if (meeting.recording_id) {
    await supabaseAdmin
      .from('recordings')
      .update({
        status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', meeting.recording_id);
    console.log(`[Webhook] Marked pending recording ${meeting.recording_id} as failed`);
  }
}

/**
 * POST /webhooks/recall/transcript
 * Handle Recall.ai real-time transcript events
 * These are sent directly from the meeting bot during recording
 * Payload format: https://docs.recall.ai/docs/real-time-webhook-endpoints
 */
router.post('/recall/transcript', async (req: Request, res: Response) => {
  const payload = req.body as RecallTranscriptWebhookPayload;
  const { event, data } = payload;

  // Log raw payload for debugging (first 500 chars)
  console.log(`[Webhook] Transcript webhook received, event: ${event}`);

  // Validate event type
  if (event !== 'transcript.data' && event !== 'transcript.partial_data') {
    console.log(`[Webhook] Ignoring transcript event: ${event}`);
    res.json({ ok: true });
    return;
  }

  // Extract bot ID from data.bot.id (not data.bot_id)
  const botId = data?.bot?.id;
  // Extract transcript data from data.data (nested structure)
  const transcriptData = data?.data;

  if (!botId || !transcriptData) {
    console.error('[Webhook] Missing bot.id or data.data in payload. Keys:', Object.keys(data || {}));
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  console.log(`[Webhook] Real-time transcript event: ${event}, bot: ${botId}, words: ${transcriptData.words?.length || 0}`);

  try {
    // Find bot_run by recall_bot_id
    const { data: botRun, error: botError } = await supabaseAdmin
      .from('bot_runs')
      .select('id, meeting_id, user_id')
      .eq('recall_bot_id', botId)
      .single();

    if (botError || !botRun) {
      console.error(`[Webhook] Bot run not found for Recall bot ${botId}`);
      // Return 200 to prevent retries for unknown bots
      res.json({ ok: true, ignored: true });
      return;
    }

    // Combine words into segment text
    const segmentText = transcriptData.words?.map(w => w.text).join(' ') || '';

    // Get timing from words (timestamps are now objects with { relative: number })
    const words = transcriptData.words || [];
    const startTimestamp = words[0]?.start_timestamp?.relative || 0;
    const endTimestamp = words[words.length - 1]?.end_timestamp?.relative || startTimestamp;

    // Get participant/speaker info from the new format
    const participant = transcriptData.participant;

    // Insert live transcript segment
    const { error: insertError } = await supabaseAdmin
      .from('live_transcripts')
      .insert({
        meeting_id: botRun.meeting_id,
        bot_run_id: botRun.id,
        user_id: botRun.user_id,
        segment_text: segmentText,
        speaker_id: participant?.id?.toString() || null,
        speaker_name: participant?.name || null,
        is_host: participant?.is_host || false,
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp,
        words: words,
        is_partial: event === 'transcript.partial_data',
      });

    if (insertError) {
      console.error(`[Webhook] Failed to insert live transcript:`, insertError);
      res.status(500).json({ error: 'Failed to store transcript' });
      return;
    }

    // For final (non-partial) transcripts, queue AI insight generation
    if (event === 'transcript.data' && segmentText.length > 0) {
      try {
        await queueInsightGeneration(botRun.meeting_id, botRun.user_id);
      } catch (insightError) {
        // Don't fail the webhook if insight generation fails
        console.error('[Webhook] Failed to queue insight generation:', insightError);
      }
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('[Webhook] Error processing transcript webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// Twilio Webhooks (Phone Calls)
// ============================================================================

/**
 * POST /webhooks/twilio/verification-voice
 * Called when user answers the verification call - reads the code
 */
router.post('/twilio/verification-voice', async (req: Request, res: Response) => {
  const code = req.query.code as string;

  console.log(`[Twilio Webhook] verification-voice: reading code`);

  if (!code || code.length !== 6) {
    console.error('[Twilio Webhook] Invalid verification code in query params');
    res.status(400).send('Invalid code');
    return;
  }

  // Return TwiML to read the verification code
  const twiml = TwilioService.buildVerificationTwiml(code);
  res.type('text/xml').send(twiml);
});

/**
 * POST /webhooks/twilio/verification-status
 * Called on verification call status changes (for logging/debugging)
 */
router.post('/twilio/verification-status', async (req: Request, res: Response) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  const phone = req.query.phone as string;

  console.log(`[Twilio Webhook] verification-status: ${CallSid}, status: ${CallStatus}, phone: ${phone}, duration: ${CallDuration}s`);

  // Just log the status - the code verification happens when user enters it in the app
  res.json({ ok: true });
});

/**
 * POST /webhooks/twilio/caller-connect
 * Called when the USER answers their phone for a server-initiated call
 * This bridges them to the recipient with recording enabled
 */
router.post('/twilio/caller-connect', async (req: Request, res: Response) => {
  const { CallSid, CallStatus } = req.body;
  const callId = req.query.call_id as string;
  const toNumber = req.query.to as string;

  console.log(`[Twilio Webhook] caller-connect: ${CallSid}, status: ${CallStatus}, call_id: ${callId}, to: ${toNumber}`);

  if (!callId || !toNumber) {
    console.error('[Twilio Webhook] Missing call_id or to in query params');
    const response = new TwiML.VoiceResponse();
    response.say('Sorry, there was an error with your call.');
    res.type('text/xml').send(response.toString());
    return;
  }

  try {
    // Update call status - user has answered
    await supabaseAdmin
      .from('phone_calls')
      .update({
        twilio_call_sid: CallSid,
        status: 'in_progress',
        answered_at: new Date().toISOString(),
      })
      .eq('id', callId);

    // Build TwiML to bridge to the recipient with recording
    const twiml = TwilioService.buildCallerConnectTwiml(toNumber, callId);
    res.type('text/xml').send(twiml);
  } catch (error) {
    console.error('[Twilio Webhook] Error in caller-connect:', error);
    const response = new TwiML.VoiceResponse();
    response.say('Sorry, there was an error with your call.');
    res.type('text/xml').send(response.toString());
  }
});

/**
 * POST /webhooks/twilio/server-call-answer
 * @deprecated Use caller-connect instead for server-initiated calls
 * Called when the RECIPIENT answers a server-initiated call
 * This plays the recording warning and starts recording
 */
router.post('/twilio/server-call-answer', async (req: Request, res: Response) => {
  const { CallSid, CallStatus } = req.body;
  const callId = req.query.call_id as string;

  console.log(`[Twilio Webhook] server-call-answer: ${CallSid}, status: ${CallStatus}, call_id: ${callId}`);

  if (!callId) {
    console.error('[Twilio Webhook] Missing call_id in query params');
    const response = new TwiML.VoiceResponse();
    response.say('Sorry, there was an error with your call.');
    res.type('text/xml').send(response.toString());
    return;
  }

  try {
    // Update call status to in_progress
    await supabaseAdmin
      .from('phone_calls')
      .update({
        twilio_call_sid: CallSid,
        status: 'in_progress',
        answered_at: new Date().toISOString(),
        is_recording: true,
        recording_started_at: new Date().toISOString(),
      })
      .eq('id', callId);

    // Build TwiML with recording warning
    // The call is already being recorded via the `record: true` parameter in initiateCall
    const response = new TwiML.VoiceResponse();

    // Play recording warning to the recipient
    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'This call is being recorded. Please be advised that this conversation may be monitored.'
    );

    response.pause({ length: 1 });

    // Continue the call - recording is already enabled via call creation
    // The call will continue and recording happens automatically

    res.type('text/xml').send(response.toString());
  } catch (error) {
    console.error('[Twilio Webhook] Error in server-call-answer:', error);
    const response = new TwiML.VoiceResponse();
    response.say('Sorry, there was an error with your call.');
    res.type('text/xml').send(response.toString());
  }
});

/**
 * POST /webhooks/twilio/voip-outbound
 * TwiML App webhook - called when VoIP client initiates an outbound call
 * This connects the VoIP caller to the recipient via a conference with recording
 *
 * NOTE: When called from Twilio Voice SDK, custom params are in req.body, NOT query params
 */
router.post('/twilio/voip-outbound', async (req: Request, res: Response) => {
  // Twilio Voice SDK sends custom params in the body
  const { From, To, CallSid, call_id: bodyCallId, to: bodyTo } = req.body;

  // Also check query params as fallback
  const queryCallId = req.query.call_id as string;
  const queryTo = req.query.to as string;

  // Prefer body params (from Voice SDK) over query params
  const targetCallId = bodyCallId || queryCallId;
  const targetNumber = bodyTo || queryTo || To;

  console.log(`[Twilio Webhook] voip-outbound: from=${From}, to=${targetNumber}, call_id=${targetCallId}, body_keys=${Object.keys(req.body).join(',')}`);
  console.log(`[Twilio Webhook] voip-outbound body:`, JSON.stringify(req.body));

  if (!targetCallId) {
    console.error('[Twilio Webhook] Missing call_id in voip-outbound');
    // Return TwiML that says error
    const response = new TwiML.VoiceResponse();
    response.say('Sorry, there was an error placing your call.');
    res.type('text/xml').send(response.toString());
    return;
  }

  try {
    // Get the call record to find the conference name and caller's verified number
    const { data: phoneCall } = await supabaseAdmin
      .from('phone_calls')
      .select('conference_name, to_number, from_number')
      .eq('id', targetCallId)
      .single();

    if (!phoneCall) {
      console.error('[Twilio Webhook] Phone call not found:', targetCallId);
      const response = new TwiML.VoiceResponse();
      response.say('Sorry, call record not found.');
      res.type('text/xml').send(response.toString());
      return;
    }

    const conferenceName = phoneCall.conference_name;
    // Use DB to_number (already E.164) as primary — iOS SDK passes raw user input without country code
    const recipientNumber = phoneCall.to_number || TwilioService.formatPhoneNumber(targetNumber);
    // Use the user's verified phone number as caller ID so it shows their number
    const callerIdNumber = phoneCall.from_number;

    console.log(`[Twilio Webhook] voip-outbound: dialing ${recipientNumber} with caller ID ${callerIdNumber}`);

    // Update call with Twilio SID
    await supabaseAdmin
      .from('phone_calls')
      .update({
        twilio_call_sid: CallSid,
        status: 'ringing',
      })
      .eq('id', targetCallId);

    // Build TwiML:
    // 1. Tell caller we're connecting
    // 2. Dial recipient with caller's verified number as caller ID
    const twiml = TwilioService.buildVoipOutboundTwiml(recipientNumber, targetCallId, conferenceName, callerIdNumber);
    res.type('text/xml').send(twiml);
  } catch (error) {
    console.error('[Twilio Webhook] Error in voip-outbound:', error);
    const response = new TwiML.VoiceResponse();
    response.say('Sorry, there was an error placing your call.');
    res.type('text/xml').send(response.toString());
  }
});

/**
 * POST /webhooks/twilio/recipient-connected
 * Called when recipient answers - plays recording warning then connects to conference
 */
router.post('/twilio/recipient-connected', async (req: Request, res: Response) => {
  const { CallSid } = req.body;
  const callId = req.query.call_id as string;
  const conferenceName = req.query.conference as string;

  console.log(`[Twilio Webhook] recipient-connected: ${CallSid}, call_id: ${callId}, conference: ${conferenceName}`);

  if (!callId || !conferenceName) {
    console.error('[Twilio Webhook] Missing call_id or conference in query params');
    res.status(400).send('Missing parameters');
    return;
  }

  try {
    // Update call status to recording since recipient answered
    await supabaseAdmin
      .from('phone_calls')
      .update({
        status: 'recording',
        answered_at: new Date().toISOString(),
        recording_started_at: new Date().toISOString(),
      })
      .eq('id', callId);

    // Return TwiML that plays recording warning then joins conference
    const twiml = TwilioService.buildRecipientJoinConferenceTwiml(conferenceName, callId);
    res.type('text/xml').send(twiml);
  } catch (error) {
    console.error('[Twilio Webhook] Error in recipient-connected:', error);
    res.status(500).send('Internal error');
  }
});

/**
 * POST /webhooks/twilio/recipient-whisper
 * Called when recipient answers - plays recording warning before connecting
 * This is a "whisper" that only the recipient hears before the call is bridged
 */
router.post('/twilio/recipient-whisper', async (req: Request, res: Response) => {
  const { CallSid } = req.body;
  const callId = req.query.call_id as string;

  console.log(`[Twilio Webhook] recipient-whisper: ${CallSid}, call_id: ${callId}`);

  try {
    // Update call status to recording since recipient answered
    if (callId) {
      await supabaseAdmin
        .from('phone_calls')
        .update({
          status: 'recording',
          answered_at: new Date().toISOString(),
          recording_started_at: new Date().toISOString(),
        })
        .eq('id', callId);
    }

    // Build TwiML that plays the recording warning
    const response = new TwiML.VoiceResponse();

    // Play recording warning to recipient
    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'This call is being recorded. Please be advised that this conversation may be monitored.'
    );

    // Short pause before connecting
    response.pause({ length: 1 });

    res.type('text/xml').send(response.toString());
  } catch (error) {
    console.error('[Twilio Webhook] Error in recipient-whisper:', error);
    // Return empty TwiML on error to continue the call
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

/**
 * POST /webhooks/twilio/call-status
 * Called on call status changes
 */
router.post('/twilio/call-status', async (req: Request, res: Response) => {
  const { CallSid, CallStatus, CallDuration, ErrorCode, ErrorMessage } = req.body;
  const callId = req.query.call_id as string;

  console.log(`[Twilio Webhook] call-status: ${CallSid}, status: ${CallStatus}, call_id: ${callId}`);

  if (!callId) {
    res.json({ ok: true });
    return;
  }

  try {
    // Map Twilio status to our status
    let status: string;
    switch (CallStatus) {
      case 'queued':
      case 'ringing':
        status = 'ringing';
        break;
      case 'in-progress':
        status = 'in_progress';
        break;
      case 'completed':
        status = 'completed';
        break;
      case 'busy':
        status = 'busy';
        break;
      case 'no-answer':
        status = 'no_answer';
        break;
      case 'canceled':
        status = 'cancelled';
        break;
      case 'failed':
        status = 'failed';
        break;
      default:
        status = CallStatus;
    }

    const updates: Record<string, any> = { status };

    if (CallStatus === 'in-progress') {
      updates.answered_at = new Date().toISOString();
    }

    if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer') {
      updates.ended_at = new Date().toISOString();
      if (CallDuration) {
        updates.recording_duration = parseInt(CallDuration);
      }
    }

    await supabaseAdmin
      .from('phone_calls')
      .update(updates)
      .eq('id', callId);

    res.json({ ok: true });
  } catch (error) {
    console.error('[Twilio Webhook] Error in call-status:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /webhooks/twilio/dial-complete
 * Called when the dialed leg ends
 */
router.post('/twilio/dial-complete', async (req: Request, res: Response) => {
  const { CallSid, DialCallStatus, DialCallDuration } = req.body;
  const callId = req.query.call_id as string;

  console.log(`[Twilio Webhook] dial-complete: ${CallSid}, dial_status: ${DialCallStatus}, call_id: ${callId}`);

  if (callId) {
    try {
      // Map dial status
      let status: string;
      switch (DialCallStatus) {
        case 'completed':
          status = 'completed';
          break;
        case 'busy':
          status = 'busy';
          break;
        case 'no-answer':
          status = 'no_answer';
          break;
        case 'failed':
          status = 'failed';
          break;
        case 'canceled':
          status = 'cancelled';
          break;
        default:
          status = 'completed';
      }

      await supabaseAdmin
        .from('phone_calls')
        .update({
          status,
          ended_at: new Date().toISOString(),
          recording_duration: DialCallDuration ? parseInt(DialCallDuration) : null,
        })
        .eq('id', callId);
    } catch (error) {
      console.error('[Twilio Webhook] Error in dial-complete:', error);
    }
  }

  // Return empty TwiML to hang up
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

/**
 * POST /webhooks/twilio/recording-complete
 * Called when a conference recording is complete
 */
router.post('/twilio/recording-complete', async (req: Request, res: Response) => {
  const {
    RecordingSid,
    RecordingUrl,
    RecordingStatus,
    RecordingDuration,
    RecordingChannels,
    RecordingSource,
    ConferenceSid,
  } = req.body;
  const callId = req.query.call_id as string;

  console.log(`[Twilio Webhook] recording-complete: ${RecordingSid}, conference: ${ConferenceSid}, call_id: ${callId}, status: ${RecordingStatus}`);

  if (RecordingStatus !== 'completed') {
    res.json({ ok: true });
    return;
  }

  try {
    let call = null;

    // First try to find by call_id from query params (most reliable)
    if (callId) {
      const { data: phoneCall } = await supabaseAdmin
        .from('phone_calls')
        .select('*')
        .eq('id', callId)
        .single();
      call = phoneCall;
    }

    // If not found by call_id, try by conference_sid
    if (!call && ConferenceSid) {
      const { data: phoneCall } = await supabaseAdmin
        .from('phone_calls')
        .select('*')
        .eq('conference_sid', ConferenceSid)
        .single();
      call = phoneCall;
    }

    // Try finding by conference_name matching the conference SID
    if (!call && ConferenceSid) {
      const { data: phoneCall } = await supabaseAdmin
        .from('phone_calls')
        .select('*')
        .eq('conference_name', `phone-call-${callId || ''}`)
        .single();
      call = phoneCall;
    }

    if (!call) {
      console.error(`[Twilio Webhook] Phone call not found for conference ${ConferenceSid}`);
      res.json({ ok: true, ignored: true });
      return;
    }

    console.log(`[Twilio Webhook] Found phone call ${call.id} for recording ${RecordingSid}`);

    // Update phone call with recording info
    await supabaseAdmin
      .from('phone_calls')
      .update({
        recording_sid: RecordingSid,
        recording_url: RecordingUrl,
        recording_duration: parseInt(RecordingDuration) || null,
        is_recording: false,
      })
      .eq('id', call.id);

    // Download recording from Twilio and store in Supabase
    try {
      const { buffer, contentType } = await TwilioService.downloadRecording(RecordingSid);

      // Generate unique file name
      const fileName = `phone-call-${call.id}-${Date.now()}.mp3`;
      const storagePath = `${call.user_id}/${fileName}`;

      // Upload to Supabase storage
      const { error: uploadError } = await supabaseAdmin.storage
        .from(config.STORAGE_BUCKET_AUDIO)
        .upload(storagePath, buffer, {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Failed to upload recording: ${uploadError.message}`);
      }

      console.log(`[Twilio Webhook] Uploaded recording to ${storagePath}`);

      // Create recording record
      const title = call.to_name
        ? `Call with ${call.to_name}`
        : `Call to ${call.to_number}`;

      const { data: recording, error: recordingError } = await supabaseAdmin
        .from('recordings')
        .insert({
          user_id: call.user_id,
          title,
          file_path: storagePath,
          duration_seconds: parseInt(RecordingDuration) || null,
          status: 'uploaded',
          source: 'phone_call',
        })
        .select()
        .single();

      if (recordingError || !recording) {
        throw new Error(`Failed to create recording: ${recordingError?.message}`);
      }

      console.log(`[Twilio Webhook] Created recording ${recording.id}`);

      // Link recording to phone call
      await supabaseAdmin
        .from('phone_calls')
        .update({ recording_id: recording.id })
        .eq('id', call.id);

      // Trigger transcription and summarization
      await triggerProcessing(recording.id, call.user_id);

      console.log(`[Twilio Webhook] Triggered processing for recording ${recording.id}`);

      // Delete recording from Twilio to save costs
      try {
        await TwilioService.deleteRecording(RecordingSid);
        console.log(`[Twilio Webhook] Deleted Twilio recording ${RecordingSid}`);
      } catch (deleteError) {
        console.error(`[Twilio Webhook] Failed to delete Twilio recording:`, deleteError);
        // Non-fatal - continue
      }
    } catch (error) {
      console.error('[Twilio Webhook] Error processing recording:', error);
      // Update phone call with error but don't fail the webhook
      await supabaseAdmin
        .from('phone_calls')
        .update({
          status: 'failed',
        })
        .eq('id', call.id);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('[Twilio Webhook] Error in recording-complete:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ============================================================================
// Stripe Webhooks (Subscriptions)
// ============================================================================

/**
 * Initialize Stripe client
 */
function getStripeClient(): Stripe | null {
  if (!config.STRIPE_SECRET_KEY) {
    return null;
  }
  return new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
  });
}

/**
 * POST /webhooks/stripe
 * Handle Stripe webhook events for subscriptions
 * IMPORTANT: This route must receive the raw body for signature verification
 */
router.post('/stripe', async (req: Request, res: Response) => {
  const stripe = getStripeClient();
  if (!stripe) {
    console.error('[Stripe Webhook] Stripe not configured');
    res.status(503).json({ error: 'Stripe not configured' });
    return;
  }

  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = config.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
    res.status(503).json({ error: 'Webhook secret not configured' });
    return;
  }

  let event: Stripe.Event;

  try {
    // Verify webhook signature - req.body should be raw buffer from express.raw() middleware
    // The raw middleware in index.ts must be applied BEFORE express.json() for this route
    let rawBody: string | Buffer;
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body;
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    } else {
      // Fallback: body was parsed as JSON (this will likely fail signature verification)
      console.warn('[Stripe Webhook] Body was parsed as JSON - signature verification may fail');
      rawBody = JSON.stringify(req.body);
    }
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err);
    console.error('[Stripe Webhook] Body type:', typeof req.body, Buffer.isBuffer(req.body) ? '(Buffer)' : '');
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  // Check for duplicate events (idempotency)
  const { data: existingEvent } = await supabaseAdmin
    .from('stripe_webhook_events')
    .select('id')
    .eq('id', event.id)
    .single();

  if (existingEvent) {
    console.log(`[Stripe Webhook] Duplicate event ${event.id}, skipping`);
    res.json({ received: true, duplicate: true });
    return;
  }

  // Log the event for idempotency
  await supabaseAdmin.from('stripe_webhook_events').insert({
    id: event.id,
    type: event.type,
    payload: event.data.object as unknown as Record<string, unknown>,
  });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaid(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[Stripe Webhook] Error processing event:', error);
    // Send alert for webhook processing failures
    await alertWebhookFailure(event.type, error, {
      eventId: event.id,
      eventType: event.type,
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.user_id;
  const planType = session.metadata?.plan_type;

  if (!userId) {
    console.error('[Stripe Webhook] No user_id in checkout session metadata');
    return;
  }

  console.log(`[Stripe Webhook] Checkout completed for user ${userId}, plan: ${planType}, subscription: ${session.subscription}`);

  // Get the subscription to check its actual status (trialing vs active)
  const stripe = getStripeClient();
  let subscriptionStatus = 'active';
  let expiresAt: string | null = null;

  if (stripe && session.subscription) {
    try {
      const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
      subscriptionStatus = subscription.status === 'trialing' ? 'trialing' : 'active';
      expiresAt = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null;
      console.log(`[Stripe Webhook] Subscription status: ${subscription.status}, trial_end: ${subscription.trial_end}`);
    } catch (err) {
      console.error('[Stripe Webhook] Failed to fetch subscription:', err);
    }
  }

  // Update user profile with subscription info
  await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: subscriptionStatus,
      subscription_provider: 'stripe',
      subscription_plan: planType || null,
      subscription_expires_at: expiresAt,
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: session.subscription as string,
      subscribed_at: new Date().toISOString(),
    })
    .eq('id', userId);

  console.log(`[Stripe Webhook] Updated subscription for user ${userId}, status: ${subscriptionStatus}, plan: ${planType}`);
}

/**
 * Handle customer.subscription.created/updated events
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const userId = subscription.metadata?.user_id;

  if (!userId) {
    // Try to find user by stripe_customer_id
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', subscription.customer as string)
      .single();

    if (!profile) {
      console.error('[Stripe Webhook] No user found for subscription:', subscription.id);
      return;
    }

    await updateSubscriptionStatus(profile.id, subscription);
  } else {
    await updateSubscriptionStatus(userId, subscription);
  }
}

/**
 * Update subscription status in database
 */
async function updateSubscriptionStatus(
  userId: string,
  subscription: Stripe.Subscription
): Promise<void> {
  // Map Stripe status to our status
  let status: string;
  switch (subscription.status) {
    case 'active':
      status = 'active';
      break;
    case 'trialing':
      status = 'trialing';
      break;
    case 'past_due':
      status = 'past_due';
      break;
    case 'canceled':
    case 'unpaid':
      status = 'canceled';
      break;
    default:
      status = 'free';
  }

  // Get plan type from metadata, or try to infer from price
  let planType = subscription.metadata?.plan_type || null;

  // If no plan type in metadata, try to determine from the price interval
  if (!planType && subscription.items?.data?.[0]?.price) {
    const price = subscription.items.data[0].price;
    if (price.recurring) {
      const interval = price.recurring.interval;
      const intervalCount = price.recurring.interval_count || 1;

      if (interval === 'week') {
        planType = 'weekly';
      } else if (interval === 'month') {
        planType = 'monthly';
      } else if (interval === 'year') {
        planType = 'yearly';
      }
      console.log(`[Stripe Webhook] Inferred plan type from price: ${planType} (${intervalCount} ${interval})`);
    }
  }

  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: status,
      subscription_provider: 'stripe',
      subscription_plan: planType,
      subscription_expires_at: currentPeriodEnd,
      stripe_subscription_id: subscription.id,
    })
    .eq('id', userId);

  console.log(`[Stripe Webhook] Updated subscription status to ${status}, plan: ${planType} for user ${userId}`);
}

/**
 * Handle customer.subscription.deleted event
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  // Find user by stripe_subscription_id
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('stripe_subscription_id', subscription.id)
    .single();

  if (!profile) {
    console.error('[Stripe Webhook] No user found for deleted subscription:', subscription.id);
    return;
  }

  await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: 'canceled',
      // Keep the expiration date so user can use until end of period
      subscription_expires_at: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : new Date().toISOString(),
    })
    .eq('id', profile.id);

  console.log(`[Stripe Webhook] Subscription canceled for user ${profile.id}`);
}

/**
 * Handle invoice.paid event
 */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.subscription) return;

  // Find user by stripe_subscription_id
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('stripe_subscription_id', invoice.subscription as string)
    .single();

  if (!profile) {
    console.log('[Stripe Webhook] No user found for invoice, might be new subscription');
    return;
  }

  // Ensure subscription is marked as active after successful payment
  await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: 'active',
    })
    .eq('id', profile.id);

  console.log(`[Stripe Webhook] Invoice paid, subscription active for user ${profile.id}`);
}

/**
 * Handle invoice.payment_failed event
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.subscription) return;

  // Find user by stripe_subscription_id
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email')
    .eq('stripe_subscription_id', invoice.subscription as string)
    .single();

  if (!profile) {
    console.error('[Stripe Webhook] No user found for failed invoice');
    // Still send alert for orphaned payment failure
    await alertPaymentFailure(
      'unknown',
      invoice.customer_email || null,
      invoice.amount_due || 0,
      'No user found for subscription'
    );
    return;
  }

  // Mark subscription as past_due
  await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: 'past_due',
    })
    .eq('id', profile.id);

  // Send alert for payment failure
  await alertPaymentFailure(
    profile.id,
    profile.email || invoice.customer_email || null,
    invoice.amount_due || 0,
    invoice.last_finalization_error?.message || 'Payment declined'
  );

  console.log(`[Stripe Webhook] Payment failed, subscription past_due for user ${profile.id}`);
}

// ============================================================================
// RevenueCat Webhooks (Mobile Subscriptions)
// ============================================================================

/**
 * RevenueCat webhook event types
 */
interface RevenueCatWebhookEvent {
  api_version: string;
  event: {
    type: string;
    id: string;
    app_user_id: string;
    original_app_user_id: string;
    aliases: string[];
    product_id: string;
    entitlement_ids: string[];
    entitlement_id?: string;
    period_type: string;
    purchased_at_ms: number;
    expiration_at_ms: number | null;
    store: 'APP_STORE' | 'PLAY_STORE' | 'STRIPE' | 'PROMOTIONAL';
    environment: 'SANDBOX' | 'PRODUCTION';
    is_trial_conversion?: boolean;
    cancel_reason?: string;
    // Apple Search Ads attribution
    subscriber_attributes?: {
      '$attConsentStatus'?: { value: string };
      '$appleSearchAdsAttributionDetails'?: {
        value: string; // JSON string with attribution data
      };
    };
  };
}

/**
 * Parsed Apple Search Ads attribution data
 */
interface AppleSearchAdsAttribution {
  'Version4.0'?: {
    attribution: boolean;
    adGroupId?: number;
    adGroupName?: string;
    adId?: number;
    adName?: string;
    campaignId?: number;
    campaignName?: string;
    countryOrRegion?: string;
    keywordId?: number;
    keyword?: string;
    orgId?: number;
    orgName?: string;
    clickDate?: string;
    conversionDate?: string;
  };
}

/**
 * POST /webhooks/revenuecat
 * Handle RevenueCat webhook events for mobile subscriptions (iOS & Android)
 */
router.post('/revenuecat', async (req: Request, res: Response) => {
  // Verify authorization header
  const authHeader = req.headers['authorization'];
  const expectedAuth = config.REVENUECAT_WEBHOOK_AUTH_HEADER;

  if (expectedAuth && authHeader !== expectedAuth) {
    console.error('[RevenueCat Webhook] Invalid authorization header');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = req.body as RevenueCatWebhookEvent;
  const event = payload.event;

  console.log(`[RevenueCat Webhook] Received: ${event.type}, user: ${event.app_user_id}, product: ${event.product_id}, store: ${event.store}`);

  // The app_user_id should be the Supabase user ID (set via logIn() in the app)
  const userId = event.app_user_id;

  // Skip anonymous IDs - these are users who haven't logged in yet
  if (userId.startsWith('$RCAnonymousID:')) {
    console.log('[RevenueCat Webhook] Skipping anonymous user');
    res.json({ received: true, skipped: true });
    return;
  }

  try {
    // Coaching IAPs (consumable packs + capped subscription) — handled
    // separately from the subscription_status profile updates so the two
    // monetization paths don't entangle. Self-filters by product_id.
    await handleCoachingIapEvent(userId, event);

    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'UNCANCELLATION':
        await handleRevenueCatSubscriptionActive(userId, event);
        break;

      case 'NON_RENEWING_PURCHASE':
        // Consumable purchase — no subscription state change, only credit
        // grant which is already handled by handleCoachingIapEvent above.
        console.log(`[RevenueCat Webhook] Non-renewing purchase: ${event.product_id} for ${userId}`);
        break;

      case 'CANCELLATION':
        await handleRevenueCatCancellation(userId, event);
        break;

      case 'EXPIRATION':
        await handleRevenueCatExpiration(userId, event);
        break;

      case 'BILLING_ISSUE':
        await handleRevenueCatBillingIssue(userId, event);
        break;

      case 'SUBSCRIBER_ALIAS':
        // User aliases were updated - no action needed
        console.log(`[RevenueCat Webhook] Subscriber alias updated for ${userId}`);
        break;

      case 'TRANSFER':
        // Subscription transferred to another user
        console.log(`[RevenueCat Webhook] Subscription transferred from ${event.original_app_user_id} to ${userId}`);
        break;

      default:
        console.log(`[RevenueCat Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[RevenueCat Webhook] Error processing event:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});

/**
 * Handle subscription activation events (INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, UNCANCELLATION)
 */
async function handleRevenueCatSubscriptionActive(
  userId: string,
  event: RevenueCatWebhookEvent['event']
): Promise<void> {
  // Map product ID to plan type
  let planType = 'monthly';
  const productId = event.product_id.toLowerCase();
  if (productId.includes('weekly')) {
    planType = 'weekly';
  } else if (productId.includes('yearly') || productId.includes('annual') || productId.includes('year')) {
    planType = 'yearly';
  }

  // Map store to provider
  const provider = event.store === 'APP_STORE' ? 'app_store' : 'play_store';

  // Determine status - check if this is during a trial period
  const status = event.period_type === 'TRIAL' ? 'trialing' : 'active';

  await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: status,
      subscription_provider: provider,
      subscription_plan: planType,
      subscription_expires_at: event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : null,
      subscribed_at: event.purchased_at_ms
        ? new Date(event.purchased_at_ms).toISOString()
        : new Date().toISOString(),
    })
    .eq('id', userId);

  // Store Apple Search Ads attribution data if available
  if (event.subscriber_attributes?.['$appleSearchAdsAttributionDetails']?.value) {
    try {
      const attributionJson = event.subscriber_attributes['$appleSearchAdsAttributionDetails'].value;
      const attribution = JSON.parse(attributionJson) as AppleSearchAdsAttribution;
      const adsData = attribution['Version4.0'];

      if (adsData && adsData.attribution) {
        await supabaseAdmin
          .from('user_attribution')
          .upsert({
            user_id: userId,
            network: 'apple_search_ads',
            campaign: adsData.campaignName || null,
            campaign_id: adsData.campaignId?.toString() || null,
            ad_group: adsData.adGroupName || null,
            ad_group_id: adsData.adGroupId?.toString() || null,
            keyword: adsData.keyword || null,
            keyword_id: adsData.keywordId?.toString() || null,
            creative: adsData.adName || null,
            creative_id: adsData.adId?.toString() || null,
            click_date: adsData.clickDate || null,
            conversion_date: adsData.conversionDate || null,
            country_or_region: adsData.countryOrRegion || null,
            updated_at: new Date().toISOString(),
          });
        console.log(`[RevenueCat Webhook] Stored Search Ads attribution for ${userId}: campaign=${adsData.campaignName}, keyword=${adsData.keyword}`);
      }
    } catch (attrError) {
      console.error('[RevenueCat Webhook] Failed to parse attribution data:', attrError);
    }
  }

  console.log(`[RevenueCat Webhook] Activated subscription for ${userId}, plan: ${planType}, status: ${status}, event: ${event.type}`);
}

/**
 * Handle subscription cancellation (user cancelled but still has access until expiration)
 */
async function handleRevenueCatCancellation(
  userId: string,
  event: RevenueCatWebhookEvent['event']
): Promise<void> {
  // User cancelled but may still have access until expiration_at_ms
  // Keep status as active if they still have time remaining
  const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : new Date();
  const hasTimeRemaining = expiresAt > new Date();

  await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: hasTimeRemaining ? 'active' : 'canceled',
      subscription_expires_at: expiresAt.toISOString(),
    })
    .eq('id', userId);

  console.log(`[RevenueCat Webhook] Subscription cancelled for ${userId}, expires: ${expiresAt.toISOString()}, reason: ${event.cancel_reason || 'unknown'}`);
}

/**
 * Handle subscription expiration (access has ended)
 */
async function handleRevenueCatExpiration(
  userId: string,
  event: RevenueCatWebhookEvent['event']
): Promise<void> {
  await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: 'canceled',
      subscription_expires_at: event.expiration_at_ms
        ? new Date(event.expiration_at_ms).toISOString()
        : new Date().toISOString(),
    })
    .eq('id', userId);

  console.log(`[RevenueCat Webhook] Subscription expired for ${userId}`);
}

// ----- Realtime coaching IAP credit grants -----

/** Credit amounts granted per coaching IAP product. */
const COACHING_PACKS: Record<string, number> = {
  mm_coach_pack_5:   5,
  mm_coach_pack_25:  25,
  mm_coach_pack_100: 100,
};
const COACHING_SUBSCRIPTION_PRODUCTS = new Set<string>([
  'mm_coach_unlimited_monthly',
]);
/** Credits granted per subscription period (the 50/mo soft cap). */
const COACHING_SUBSCRIPTION_MONTHLY_CREDITS = 50;

/**
 * Grant coaching credits when the RevenueCat event corresponds to a coaching
 * IAP. Self-filters by product_id and event type so it's safe to call for
 * every RC event. Idempotent via the transaction id (source_event_id).
 */
async function handleCoachingIapEvent(
  userId: string,
  event: RevenueCatWebhookEvent['event']
): Promise<void> {
  const productId = event.product_id;

  // Consumable pack — granted on NON_RENEWING_PURCHASE
  if (COACHING_PACKS[productId] && event.type === 'NON_RENEWING_PURCHASE') {
    const amount = COACHING_PACKS[productId];
    await grantCredits(userId, amount, 'iap', {
      productId,
      sourceEventId: event.id,
    });
    console.log(`[Coaching] Granted ${amount} credits to ${userId} from consumable ${productId}`);
    return;
  }

  // Subscription — granted on every INITIAL_PURCHASE + RENEWAL, expires when
  // the period does (so unused credits don't roll over indefinitely).
  if (COACHING_SUBSCRIPTION_PRODUCTS.has(productId) &&
      (event.type === 'INITIAL_PURCHASE' || event.type === 'RENEWAL' || event.type === 'UNCANCELLATION')) {
    const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;
    await grantCredits(userId, COACHING_SUBSCRIPTION_MONTHLY_CREDITS, 'subscription', {
      productId,
      sourceEventId: event.id,
      expiresAt,
    });
    console.log(`[Coaching] Granted ${COACHING_SUBSCRIPTION_MONTHLY_CREDITS} credits to ${userId} for sub renewal ${productId}, expires ${expiresAt?.toISOString() || 'never'}`);
  }
}

/**
 * Handle billing issues (payment failed but subscription not yet expired)
 */
async function handleRevenueCatBillingIssue(
  userId: string,
  event: RevenueCatWebhookEvent['event']
): Promise<void> {
  await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: 'past_due',
    })
    .eq('id', userId);

  // Optionally send alert for billing issues
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .single();

  if (profile?.email) {
    await alertPaymentFailure(
      userId,
      profile.email,
      0, // RevenueCat doesn't provide amount
      'Mobile subscription billing issue'
    );
  }

  console.log(`[RevenueCat Webhook] Billing issue for ${userId}`);
}

export default router;
