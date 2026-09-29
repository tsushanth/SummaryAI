/**
 * Recall.ai Service
 * API client for Recall.ai meeting bot service
 */

import {
  RecallBotCreateRequest,
  RecallBotResponse,
  MeetingPlatform,
  BotRun,
  Meeting,
} from '../types/meetings.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { triggerProcessing } from './processingService.js';

// Get region from config or default to us-west-2
const RECALL_REGION = config.RECALL_REGION || 'us-west-2';
const RECALL_API_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`;

/**
 * Recall.ai API Service
 */
export class RecallService {
  private static get apiKey(): string {
    const key = config.RECALL_API_KEY;
    if (!key) {
      throw new Error('RECALL_API_KEY environment variable is not set');
    }
    return key;
  }

  /**
   * Make an authenticated request to Recall.ai API
   */
  private static async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${RECALL_API_BASE}${endpoint}`;

    console.log(`[Recall API] ${options.method || 'GET'} ${endpoint}`);

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Recall API] Error ${response.status}: ${errorText}`);
      throw new Error(`Recall API error: ${response.status} - ${errorText}`);
    }

    // Handle empty responses (like DELETE)
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text);
  }

  /**
   * Create a bot and send it to a meeting
   * Uses the new Recall.ai API structure with recording_config
   * Enables real-time transcript streaming via webhook when SERVICE_URL is configured
   */
  static async createBot(
    params: RecallBotCreateRequest,
    options?: { enableRealtimeTranscript?: boolean }
  ): Promise<RecallBotResponse> {
    // Enable real-time by default if SERVICE_URL is configured
    const enableRealtime = options?.enableRealtimeTranscript ?? !!config.SERVICE_URL;

    // Build the recording config with optional real-time endpoints
    const recordingConfig: Record<string, unknown> = {
      transcript: {
        provider: {
          recallai_streaming: {
            // Use low latency mode for real-time, accuracy mode otherwise
            mode: enableRealtime ? 'prioritize_low_latency' : 'prioritize_accuracy',
            // Low latency mode only supports English
            language_code: 'en',
          },
        },
      },
    };

    // Add real-time webhook endpoint for live transcription
    if (enableRealtime && config.SERVICE_URL) {
      recordingConfig.realtime_endpoints = [
        {
          type: 'webhook',
          url: `${config.SERVICE_URL}/v1/webhooks/recall/transcript`,
          events: ['transcript.data', 'transcript.partial_data'],
        },
      ];
      console.log(`[Recall] Real-time transcript enabled, webhook: ${config.SERVICE_URL}/v1/webhooks/recall/transcript`);
    }

    const payload: Record<string, unknown> = {
      meeting_url: params.meeting_url,
      bot_name: params.bot_name || 'Meeting Mind',
      automatic_leave: params.automatic_leave || {
        waiting_room_timeout: 600, // 10 minutes
        noone_joined_timeout: 300, // 5 minutes
        everyone_left_timeout: 30, // 30 seconds
      },
      recording_config: recordingConfig,
    };

    // Only add join_at if specified (for scheduled bots)
    if (params.join_at) {
      payload.join_at = params.join_at;
    }

    console.log(`[Recall] Creating bot for meeting: ${params.meeting_url}`);

    return this.request<RecallBotResponse>('/bot', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Get bot status and details
   */
  static async getBot(botId: string): Promise<RecallBotResponse> {
    return this.request<RecallBotResponse>(`/bot/${botId}`);
  }

  /**
   * Cancel/delete a bot
   */
  static async cancelBot(botId: string): Promise<void> {
    await this.request(`/bot/${botId}`, {
      method: 'DELETE',
    });
    console.log(`[Recall] Cancelled bot: ${botId}`);
  }

  /**
   * Schedule a bot to join a meeting at a specific time
   */
  static async scheduleBot(
    meetingUrl: string,
    joinAt: Date,
    botName?: string
  ): Promise<RecallBotResponse> {
    return this.createBot({
      meeting_url: meetingUrl,
      bot_name: botName,
      join_at: joinAt.toISOString(),
    });
  }
}

/**
 * Detect meeting platform from URL
 * Supports all platforms that Recall.ai can join
 */
export function detectPlatform(url: string): MeetingPlatform {
  const lowerUrl = url.toLowerCase();

  // Zoom
  if (lowerUrl.includes('zoom.us') || lowerUrl.includes('zoom.com')) {
    return 'zoom';
  }

  // Google Meet
  if (lowerUrl.includes('meet.google.com')) {
    return 'google_meet';
  }

  // Microsoft Teams (including Outlook meeting links that use Teams)
  if (
    lowerUrl.includes('teams.microsoft.com') ||
    lowerUrl.includes('teams.live.com') ||
    lowerUrl.includes('outlook.office.com') ||
    lowerUrl.includes('outlook.live.com')
  ) {
    return 'teams';
  }

  // Webex
  if (lowerUrl.includes('webex.com')) {
    return 'webex';
  }

  // GoTo Meeting / GoTo Webinar
  if (
    lowerUrl.includes('gotomeet.me') ||
    lowerUrl.includes('gotomeeting.com') ||
    lowerUrl.includes('goto.com') ||
    lowerUrl.includes('gotowebinar.com')
  ) {
    return 'goto_meeting';
  }

  // Amazon Chime
  if (lowerUrl.includes('chime.aws')) {
    return 'chime';
  }

  // BlueJeans
  if (lowerUrl.includes('bluejeans.com')) {
    return 'bluejeans';
  }

  // RingCentral
  if (lowerUrl.includes('ringcentral.com') || lowerUrl.includes('rcmeetings.com')) {
    return 'ringcentral';
  }

  // Lifesize
  if (lowerUrl.includes('lifesize.com') || lowerUrl.includes('lifesizecloud.com')) {
    return 'lifesize';
  }

  // Slack Huddles
  if (lowerUrl.includes('slack.com') && lowerUrl.includes('huddle')) {
    return 'slack';
  }

  // Whereby
  if (lowerUrl.includes('whereby.com')) {
    return 'whereby';
  }

  // Vonage / Tokbox
  if (lowerUrl.includes('vonage.com') || lowerUrl.includes('tokbox.com')) {
    return 'vonage';
  }

  // Daily.co
  if (lowerUrl.includes('daily.co')) {
    return 'daily';
  }

  // Demio
  if (lowerUrl.includes('demio.com')) {
    return 'demio';
  }

  // Loom
  if (lowerUrl.includes('loom.com')) {
    return 'loom';
  }

  // Riverside.fm
  if (lowerUrl.includes('riverside.fm')) {
    return 'riverside';
  }

  // Around
  if (lowerUrl.includes('around.co')) {
    return 'around';
  }

  // CoScreen
  if (lowerUrl.includes('coscreen.co')) {
    return 'coscreen';
  }

  // FaceTime (Apple)
  if (lowerUrl.includes('facetime.apple.com')) {
    return 'facetime';
  }

  // HubSpot Meetings
  if (lowerUrl.includes('hubspot.com') && lowerUrl.includes('meetings')) {
    return 'hubspot';
  }

  // Ping
  if (lowerUrl.includes('ping.gg')) {
    return 'ping';
  }

  // Skylead
  if (lowerUrl.includes('skylead.io')) {
    return 'skylead';
  }

  return 'unknown';
}

/**
 * Validate a meeting URL
 */
export function isValidMeetingUrl(url: string): boolean {
  try {
    new URL(url);
    const platform = detectPlatform(url);
    if (platform === 'unknown') {
      console.warn(`[Recall] Unknown meeting platform for URL: ${url}`);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Download recording from Recall.ai and upload to Supabase Storage
 */
export async function downloadAndStoreRecording(
  recallMediaUrl: string,
  userId: string,
  meetingId: string
): Promise<{ storagePath: string; durationSeconds: number }> {
  console.log(`[Recall] Downloading recording for meeting ${meetingId}`);

  // Download from Recall
  const response = await fetch(recallMediaUrl);

  if (!response.ok) {
    throw new Error(`Failed to download recording: ${response.status}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const fileSize = audioBuffer.byteLength;

  console.log(`[Recall] Downloaded ${fileSize} bytes`);

  // Determine file extension from URL or default to mp3
  const ext = recallMediaUrl.includes('.mp4') ? 'mp4' : 'mp3';
  const contentType = ext === 'mp4' ? 'audio/mp4' : 'audio/mpeg';

  // Generate storage path
  const storagePath = `${userId}/${meetingId}.${ext}`;

  // Upload to Supabase storage
  const { error } = await supabaseAdmin.storage
    .from(config.STORAGE_BUCKET_AUDIO)
    .upload(storagePath, audioBuffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    console.error(`[Recall] Storage upload error:`, error);
    throw new Error(`Failed to upload recording: ${error.message}`);
  }

  console.log(`[Recall] Uploaded recording to: ${storagePath}`);

  // Estimate duration from file size (rough estimate)
  // For MP3 at 128kbps: ~1MB per minute
  const estimatedDuration = Math.round((fileSize / 1024 / 1024) * 60);

  return {
    storagePath,
    durationSeconds: estimatedDuration,
  };
}

/**
 * Fetch a bot's recording media URL from Recall.ai's bot details response,
 * preferring video_mixed > audio_mixed > audio > top-level video_url.
 */
export async function fetchRecallMediaUrl(recallBotId: string): Promise<string | null> {
  const recallApiKey = config.RECALL_API_KEY;
  const recallRegion = config.RECALL_REGION || 'us-west-2';
  const baseUrl = `https://${recallRegion}.recall.ai/api/v1`;

  const response = await fetch(`${baseUrl}/bot/${recallBotId}`, {
    headers: {
      Authorization: `Token ${recallApiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch bot details: ${response.status}`);
  }

  const botDetails = (await response.json()) as {
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

  let mediaUrl = botDetails.video_url;

  if (botDetails.recordings && botDetails.recordings.length > 0) {
    const recording = botDetails.recordings[0];
    const shortcuts = recording?.media_shortcuts;

    if (shortcuts?.video_mixed?.data?.download_url) {
      mediaUrl = shortcuts.video_mixed.data.download_url;
    } else if (shortcuts?.audio_mixed?.data?.download_url) {
      mediaUrl = shortcuts.audio_mixed.data.download_url;
    } else if (shortcuts?.audio?.data?.download_url) {
      mediaUrl = shortcuts.audio.data.download_url;
    }
  }

  return mediaUrl || null;
}

export type FinalizeBotRecordingResult =
  | { outcome: 'finalized'; recordingId: string }
  | { outcome: 'no_media' };

/**
 * Finalize a bot-sourced recording: fetch the media URL from Recall, download
 * and store it, then advance the recording/meeting/bot_run rows and kick off
 * transcription. Shared by the `recording.done`/`audio_mixed.done` webhook
 * handler and by the polling reconciler that catches cases where that
 * webhook never arrives.
 *
 * Throws on transient failures (network/API/storage errors) so callers can
 * retry later; returns `{ outcome: 'no_media' }` when Recall has finished
 * processing but produced no downloadable media (a real, non-retryable
 * failure the caller should surface as an error).
 */
export async function finalizeBotRecording(
  botRun: BotRun,
  meeting: Meeting,
  durationSecondsHint?: number | null
): Promise<FinalizeBotRecordingResult> {
  console.log(`[Recall] Finalizing recording for bot ${botRun.id}`);

  const mediaUrl = await fetchRecallMediaUrl(botRun.recall_bot_id);

  if (!mediaUrl) {
    console.error(`[Recall] No media URL found for bot ${botRun.id}`);
    return { outcome: 'no_media' };
  }

  const { storagePath, durationSeconds } = await downloadAndStoreRecording(
    mediaUrl,
    meeting.user_id,
    meeting.id
  );

  const finalDuration = durationSecondsHint || durationSeconds;

  let recording: { id: string };

  if (meeting.recording_id) {
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
      throw new Error(`Failed to update recording: ${updateError.message}`);
    }
    recording = existingRecording;
    console.log(`[Recall] Updated existing recording ${recording.id} for meeting ${meeting.id}`);
  } else {
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
    console.log(`[Recall] Created new recording ${recording.id} for meeting ${meeting.id}`);
  }

  await supabaseAdmin
    .from('bot_runs')
    .update({
      status: 'completed',
      recording_url: mediaUrl,
      duration_seconds: finalDuration,
    })
    .eq('id', botRun.id);

  await supabaseAdmin
    .from('meetings')
    .update({
      status: 'completed',
      recording_id: recording.id,
    })
    .eq('id', meeting.id);

  await triggerProcessing(recording.id, meeting.user_id);
  console.log(`[Recall] Triggered processing for recording ${recording.id}`);

  return { outcome: 'finalized', recordingId: recording.id };
}

/**
 * Map Recall.ai status codes to our internal status
 */
export function mapRecallStatus(
  recallCode: string
): { botStatus: string; meetingStatus: string } | null {
  const statusMap: Record<string, { botStatus: string; meetingStatus: string }> = {
    // Joining states
    joining_call: { botStatus: 'joining', meetingStatus: 'bot_joining' },
    in_waiting_room: { botStatus: 'joining', meetingStatus: 'bot_joining' },

    // In-call states
    in_call_not_recording: { botStatus: 'in_call', meetingStatus: 'bot_in_meeting' },
    in_call_recording: { botStatus: 'recording', meetingStatus: 'bot_in_meeting' },

    // Post-call states
    call_ended: { botStatus: 'processing', meetingStatus: 'bot_left' },
    done: { botStatus: 'processing', meetingStatus: 'bot_left' },

    // Error states
    fatal: { botStatus: 'failed', meetingStatus: 'failed' },
    error: { botStatus: 'failed', meetingStatus: 'failed' },
  };

  return statusMap[recallCode] || null;
}
