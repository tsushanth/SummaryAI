/**
 * Meeting Bot Types
 * Types for calendar connections, meetings, bot runs, and Recall.ai integration
 */

import { z } from 'zod';

// ============================================
// Enums/Types
// ============================================

export type CalendarProvider = 'google' | 'microsoft';

// All platforms supported by Recall.ai
export type MeetingPlatform =
  | 'zoom'
  | 'google_meet'
  | 'teams'
  | 'webex'
  | 'goto_meeting'
  | 'chime'
  | 'bluejeans'
  | 'ringcentral'
  | 'lifesize'
  | 'slack'
  | 'whereby'
  | 'vonage'
  | 'daily'
  | 'demio'
  | 'loom'
  | 'riverside'
  | 'around'
  | 'coscreen'
  | 'facetime'
  | 'hubspot'
  | 'ping'
  | 'skylead'
  | 'unknown';

export type MeetingSource = 'calendar' | 'manual';

export type MeetingStatus =
  | 'scheduled'
  | 'bot_queued'
  | 'bot_joining'
  | 'bot_in_meeting'
  | 'bot_left'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type BotRunStatus =
  | 'pending'
  | 'joining'
  | 'in_call'
  | 'recording'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SchedulerJobStatus = 'scheduled' | 'executed' | 'cancelled' | 'failed';

// ============================================
// Database Models
// ============================================

export interface OAuthState {
  id: string;
  state: string;
  user_id: string;
  provider: string;
  expires_at: string;
  created_at: string;
}

export interface CalendarConnection {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string;
  provider_account_id: string | null;
  provider_email: string | null;
  sync_token: string | null;
  last_synced_at: string | null;
  sync_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Meeting {
  id: string;
  user_id: string;
  source: MeetingSource;
  calendar_connection_id: string | null;
  calendar_event_id: string | null;
  calendar_event_etag: string | null;
  title: string;
  description: string | null;
  platform: MeetingPlatform | null;
  join_url: string;
  scheduled_start: string;
  scheduled_end: string | null;
  timezone: string;
  auto_join: boolean;
  join_offset_minutes: number;
  status: MeetingStatus;
  recording_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface BotRun {
  id: string;
  meeting_id: string;
  user_id: string;
  recall_bot_id: string;
  recall_status: string | null;
  status: BotRunStatus;
  join_requested_at: string | null;
  joined_at: string | null;
  left_at: string | null;
  recording_url: string | null;
  transcript_url: string | null;
  duration_seconds: number | null;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface BotSchedulerJob {
  id: string;
  meeting_id: string;
  cloud_task_name: string | null;
  scheduled_for: string;
  status: SchedulerJobStatus;
  executed_at: string | null;
  error_message: string | null;
  created_at: string;
}

// ============================================
// Sharing Preferences
// ============================================

export type ShareRecipient = 'myself' | 'team' | 'everyone';

export interface SharingPreferences {
  id: string;
  user_id: string;
  send_to_myself: boolean;
  send_to_team: boolean;
  send_to_everyone: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================
// API Request Schemas (Zod)
// ============================================

export const CreateManualMeetingSchema = z.object({
  title: z.string().min(1).max(500),
  join_url: z.string().url(),
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime().optional(),
  auto_join: z.boolean().default(false),
  join_offset_minutes: z.number().int().min(0).max(15).default(1),
});

export const UpdateMeetingSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  auto_join: z.boolean().optional(),
  join_offset_minutes: z.number().int().min(0).max(15).optional(),
});

export const ListMeetingsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  days_ahead: z.coerce.number().int().min(1).max(30).default(14),
});

export const BotJoinWorkerSchema = z.object({
  meetingId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const UpdateSharingPreferencesSchema = z.object({
  send_to_myself: z.boolean().optional(),
  send_to_team: z.boolean().optional(),
  send_to_everyone: z.boolean().optional(),
});

export const InstantJoinSchema = z.object({
  join_url: z.string().url(),
  bot_name: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(500).optional(),
});

// ============================================
// API Response Types
// ============================================

export interface CalendarConnectionResponse {
  id: string;
  provider: CalendarProvider;
  provider_email: string | null;
  sync_enabled: boolean;
  last_synced_at: string | null;
  created_at: string;
}

export interface MeetingListItem {
  id: string;
  title: string;
  platform: MeetingPlatform | null;
  source: MeetingSource;
  scheduled_start: string;
  scheduled_end: string | null;
  auto_join: boolean;
  status: MeetingStatus;
  recording_id: string | null;
}

export interface MeetingListResponse {
  items: MeetingListItem[];
  total: number;
}

export interface BotRunResponse {
  id: string;
  status: BotRunStatus;
  joined_at: string | null;
  left_at: string | null;
  duration_seconds: number | null;
  error_message: string | null;
}

export interface MeetingDetailResponse {
  id: string;
  title: string;
  description: string | null;
  platform: MeetingPlatform | null;
  join_url: string;
  source: MeetingSource;
  scheduled_start: string;
  scheduled_end: string | null;
  timezone: string;
  auto_join: boolean;
  join_offset_minutes: number;
  status: MeetingStatus;
  recording_id: string | null;
  bot_run: BotRunResponse | null;
  error_message: string | null;
  created_at: string;
}

export interface CalendarConnectResponse {
  auth_url: string;
}

export interface CalendarSyncResponse {
  synced: number;
  meetings_created: number;
  meetings_updated: number;
}

export interface SharingPreferencesResponse {
  send_to_myself: boolean;
  send_to_team: boolean;
  send_to_everyone: boolean;
}

// ============================================
// Recall.ai Types
// ============================================

export interface RecallBotCreateRequest {
  meeting_url: string;
  bot_name?: string;
  join_at?: string; // ISO 8601
  transcription_options?: {
    provider?: 'recall' | 'assembly_ai' | 'deepgram';
  };
  recording_mode?: 'speaker_view' | 'gallery_view' | 'audio_only';
  automatic_leave?: {
    waiting_room_timeout?: number;
    noone_joined_timeout?: number;
    everyone_left_timeout?: number;
  };
}

export interface RecallBotResponse {
  id: string;
  status: string;
  meeting_url: string;
  status_changes?: Array<{
    code: string;
    message: string;
    created_at: string;
  }>;
  video_url?: string;
  audio_url?: string;
  transcript?: RecallTranscript[];
}

export interface RecallTranscript {
  speaker: string;
  words: Array<{
    text: string;
    start_time: number;
    end_time: number;
  }>;
}

export interface RecallWebhookPayload {
  event: string;
  data: {
    bot_id: string;
    status?: string;
    code?: string;
    sub_code?: string;
    message?: string;
    video_url?: string;
    audio_url?: string;
    transcript_url?: string;
    duration_seconds?: number;
  };
}

// ============================================
// Google Calendar Types
// ============================================

export interface GoogleCalendarEvent {
  id: string;
  etag: string;
  summary?: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType: string;
      uri?: string;
      label?: string;
    }>;
    conferenceSolution?: {
      name: string;
      key: {
        type: string;
      };
    };
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

// ============================================
// Helper Types
// ============================================

export type CreateManualMeetingInput = z.infer<typeof CreateManualMeetingSchema>;
export type UpdateMeetingInput = z.infer<typeof UpdateMeetingSchema>;
export type ListMeetingsInput = z.infer<typeof ListMeetingsSchema>;
export type BotJoinWorkerInput = z.infer<typeof BotJoinWorkerSchema>;
export type UpdateSharingPreferencesInput = z.infer<typeof UpdateSharingPreferencesSchema>;
