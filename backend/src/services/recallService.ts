/**
 * Recall.ai Service
 * API client for Recall.ai meeting bot service
 */

import { reportProviderHttpFailure, reportAlert } from '../lib/alerts.js';
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
import { buildIngestUrl, mintLiveSttRef, planLiveStt } from '../lib/liveStt.js';
import { planVoiceAssistant } from './voiceAssistant/recallIntegration.js';
import { isMissingColumn } from './meetingLanguage.js';
import {
  languageToStore,
  normalizeTranscriptionLanguage,
  recallTranscriptProvider,
  sonioxLanguageHints,
} from '../lib/transcriptionLanguage.js';

// Get region from config or default to us-west-2
const RECALL_REGION = config.RECALL_REGION || 'us-west-2';
const RECALL_API_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`;

/**
 * Message the bot posts to the meeting chat when it joins (only if MEETING_BOT_ANNOUNCE=true).
 * Plain ASCII, no em dashes, under Google Meet's 500 character chat limit.
 */
export const BOT_ANNOUNCEMENT_MESSAGE =
  'MeetingMind is recording this meeting to make notes for the host. Tell the host if you do not want to be recorded.';

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
      reportProviderHttpFailure('recall', response.status);
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

    // Per-meeting transcription language (backend/LIVE_STT.md). Unknown codes are ignored here: the routes validate and reject
    // them before this point, and a bad value must never become a bot that fails to start.
    const language = normalizeTranscriptionLanguage(params.transcription_language) ?? 'auto';

    // Live STT provider (backend/LIVE_STT.md). Default 'recall' leaves the request exactly as it was.
    const plan = planLiveStt({
      LIVE_STT_PROVIDER: config.LIVE_STT_PROVIDER,
      LIVE_STT_SHADOW: config.LIVE_STT_SHADOW,
      LIVE_STT_SHADOW_USER_IDS: config.LIVE_STT_SHADOW_USER_IDS,
      LIVE_STT_WS_URL: config.LIVE_STT_WS_URL,
      LIVE_STT_INGEST_SECRET: config.LIVE_STT_INGEST_SECRET,
      NODE_ENV: config.NODE_ENV,
    }, params.user_id);
    if (plan.provider === 'recall' && plan.reason === 'misconfigured') {
      // Fail safe: the bot still gets Recall's own transcript. Names only, never values.
      console.error('[Recall] LIVE_STT requested but LIVE_STT_WS_URL (wss://...) or LIVE_STT_INGEST_SECRET is missing/invalid; using Recall transcript');
      reportAlert('live_stt', 'LIVE_STT_MISCONFIGURED', {}, 60 * 60_000);
    }
    const liveStt = plan.provider === 'recall' ? undefined : { ref: mintLiveSttRef(), provider: plan.provider };
    const wsEndpoint = plan.provider === 'recall' || !liveStt
      ? undefined
      : {
          type: 'websocket',
          url: buildIngestUrl(plan.wsBase, plan.ingestSecret, liveStt.ref, sonioxLanguageHints(language)[0]),
          events: ['audio_mixed_raw.data', 'participant_events.speech_on', 'participant_events.speech_off'],
        };

    // Build the recording config with optional real-time endpoints
    let recordingConfig: Record<string, unknown>;
    if (plan.provider === 'soniox' && wsEndpoint) {
      // Soniox is the source of truth: no Recall transcript block (also drops the per-hour Recall transcript add-on).
      recordingConfig = { audio_mixed_raw: {}, realtime_endpoints: [wsEndpoint] };
      console.log('[Recall] Live STT = soniox, audio_mixed_raw websocket endpoint enabled');
    } else {
      recordingConfig = {
        transcript: {
          provider: {
            recallai_streaming: recallTranscriptProvider(language, enableRealtime, {
              autoDetect: config.RECALL_AUTO_LANGUAGE === 'detect',
            }),
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

      if (plan.provider === 'shadow' && wsEndpoint) {
        // Shadow: Recall's transcript stays the source of truth; the audio stream feeds mm-live-stt for an A/B comparison only.
        recordingConfig.audio_mixed_raw = {};
        const eps = (recordingConfig.realtime_endpoints as unknown[] | undefined) ?? [];
        recordingConfig.realtime_endpoints = [...eps, wsEndpoint];
        console.log('[Recall] Live STT shadow: audio_mixed_raw websocket endpoint added next to Recall transcript');
      }
    }

    // In-meeting voice assistant (docs/VOICE_ASSISTANT.md). Null (and a bot exactly as before) unless the flags and the user's
    // preference allow it and Recall's own real-time transcript is the live source.
    const assistant = await planVoiceAssistant({
      userId: params.user_id,
      serviceUrl: config.SERVICE_URL,
      internalSecret: config.INTERNAL_SECRET,
      realtimeRecallTranscript: enableRealtime && plan.provider !== 'soniox',
    });
    if (assistant) {
      const eps = (recordingConfig.realtime_endpoints as unknown[] | undefined) ?? [];
      recordingConfig.realtime_endpoints = [...eps, assistant.endpoint];
      console.log('[Recall] Voice assistant endpoint added');
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

    // Join announcement via Recall's automatic chat message (create-bot field `chat.on_bot_join`).
    // Platforms Recall cannot chat on (Webex, GoTo) ignore it.
    if (config.MEETING_BOT_ANNOUNCE) {
      payload.chat = {
        on_bot_join: {
          send_to: 'everyone',
          message: BOT_ANNOUNCEMENT_MESSAGE,
        },
      };
    }

    if (assistant?.automaticAudioOutput) payload.automatic_audio_output = assistant.automaticAudioOutput;

    console.log(`[Recall] Creating bot for meeting: ${params.meeting_url}`);

    const bot = await this.request<RecallBotResponse>('/bot', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    // Callers store these on the bot_run (see liveSttBotRunColumns). Absent on the default path.
    if (liveStt) bot.live_stt = liveStt;
    return bot;
  }

  /** Play an MP3 (base64) into the call through the bot. Used by the in-meeting voice assistant. */
  static async outputAudio(botId: string, mp3Base64: string): Promise<void> {
    await this.request(`/bot/${botId}/output_audio/`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'mp3', b64_data: mp3Base64 }),
    });
  }

  /** Stop whatever the bot is currently playing (barge-in). */
  static async stopOutputAudio(botId: string): Promise<void> {
    await this.request(`/bot/${botId}/output_audio/`, { method: 'DELETE' });
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
   * Account purge: permanently delete all recording media Recall stores for a bot
   * (POST /bot/{id}/delete_media/). Documented responses: 200 ok, 400 bot still in progress, 409 deletion already
   * running. 404 (bot unknown / already purged) counts as done. 'in_progress' means "try again later".
   * Direct fetch on purpose: the shared request() alerts on every non-2xx, and 400/404/409 are expected here.
   */
  static async deleteBotMedia(botId: string): Promise<'deleted' | 'not_found' | 'in_progress'> {
    if (!/^[A-Za-z0-9_-]+$/.test(botId)) throw new Error('Invalid Recall bot id');
    const response = await fetch(`${RECALL_API_BASE}/bot/${botId}/delete_media/`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'application/json' },
    });
    if (response.ok) return 'deleted';
    if (response.status === 404) return 'not_found';
    if (response.status === 400 || response.status === 409) return 'in_progress';
    reportProviderHttpFailure('recall', response.status);
    throw new Error(`Recall delete_media failed: ${response.status}`);
  }

  /**
   * Account purge: best-effort stop. Cancels a bot that has not joined yet and asks a live bot to leave, so a deleted
   * account's bot does not keep recording. Never throws: a bot that already finished answers 4xx.
   */
  static async stopBot(botId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]+$/.test(botId)) return;
    const headers = { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'application/json' };
    for (const [method, path] of [['DELETE', `/bot/${botId}`], ['POST', `/bot/${botId}/leave_call/`]] as const) {
      try {
        await fetch(`${RECALL_API_BASE}${path}`, { method, headers });
      } catch {
        /* best effort */
      }
    }
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
 * Extra bot_runs columns for a bot created by createBot. `{}` on the default (recall) path, so the bot_runs insert is unchanged
 * and works before migration 026 is applied.
 */
export function liveSttBotRunColumns(bot: Pick<RecallBotResponse, 'live_stt'>): { live_stt_ref?: string; live_stt_provider?: string } {
  return bot.live_stt ? { live_stt_ref: bot.live_stt.ref, live_stt_provider: bot.live_stt.provider } : {};
}

/**
 * Extra bot_runs/meetings column for the chosen transcription language. `{}` for auto/none, so default inserts are unchanged and
 * keep working before migration 027 is applied.
 */
export function transcriptionLanguageColumns(language: string | null | undefined): { transcription_language?: string } {
  const stored = languageToStore(language);
  return stored ? { transcription_language: stored } : {};
}

/**
 * Insert a row that may carry a column added by a migration that might not be applied yet (027 transcription_language).
 * If the database reports that exact column missing, retry once without it: the bot_runs/meetings row MUST still be written
 * (the bot is already running; callers of the old inserts do not check errors). Any other error is returned untouched.
 */
export async function insertWithOptionalColumn<R extends Record<string, unknown>>(
  table: { insert(row: R): PromiseLike<{ error: { code?: string; message?: string } | null }> },
  row: R,
  column: string
): Promise<{ error: { code?: string; message?: string } | null }> {
  const first = await table.insert(row);
  if (!(column in row) || !isMissingColumn(first.error, column)) return first;
  console.warn(`[DB] column ${column} is missing (migration not applied); retrying the insert without it`);
  const { [column]: _dropped, ...rest } = row;
  return table.insert(rest as unknown as R);
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
