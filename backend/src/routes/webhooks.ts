/**
 * Webhook Routes
 * Handles webhooks from external services (Recall.ai)
 * Recall.ai uses Svix for webhook delivery
 */

import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { twiml as TwiML } from 'twilio';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { RecallWebhookPayload, BotRun, Meeting, RecallTranscriptWebhookPayload } from '../types/meetings.js';
import { downloadAndStoreRecording } from '../services/recallService.js';
import { triggerProcessing } from '../services/processingService.js';
import { queueInsightGeneration } from '../services/liveInsightsService.js';
import { TwilioService } from '../services/twilioService.js';

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
    const recipientNumber = targetNumber || phoneCall.to_number;
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

export default router;
