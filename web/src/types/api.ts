// Recording types
export type RecordingStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'transcribing'
  | 'transcribed'
  | 'summarizing'
  | 'completed'
  | 'failed';

export type RecordingType =
  | 'general'
  | 'meeting'
  | 'lecture'
  | 'interview'
  | 'voice_memo'
  | 'imported';

export interface Recording {
  id: string;
  user_id: string;
  title: string;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  file_path: string | null;
  status: RecordingStatus;
  error_message: string | null;
  speaker_count: number | null;
  word_count: number | null;
  language: string | null;
  tags: string[];
  is_favorite: boolean;
  recording_type: RecordingType;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface TranscriptSegment {
  segment_id: string;
  speaker_label: string;
  speaker_index: number;
  text: string;
  start_time: number;
  end_time: number;
  confidence: number;
}

export interface Transcript {
  id: string;
  recording_id: string;
  full_text: string;
  segments: TranscriptSegment[];
  word_count: number;
  speaker_count: number;
  language: string;
  created_at: string;
  /** Maps speaker_index (as string) to custom speaker name */
  speaker_names?: Record<string, string>;
}

export interface ActionItem {
  text: string;
  assignee: string | null;
  due_date: string | null;
  priority: 'high' | 'medium' | 'low';
}

export interface Summary {
  id: string;
  recording_id: string;
  summary: string;
  key_points: string[];
  action_items: ActionItem[];
  topics: string[];
  created_at: string;
}

// Todo types
export type TodoPriority = 'low' | 'medium' | 'high';
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface Todo {
  id: string;
  user_id: string;
  recording_id: string | null;
  title: string;
  description: string | null;
  status: TodoStatus;
  is_completed: boolean;
  priority: TodoPriority;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Q&A types
export interface Citation {
  segment_id: string | null;
  timestamp: number;
  text: string;
  relevance_score: number | null;
}

export interface QAItem {
  id: string;
  recording_id: string;
  user_id: string;
  question: string;
  answer: string;
  citations: Citation[];
  confidence: number | null;
  created_at: string;
}

// API Response types
export interface CreateRecordingRequest {
  title: string;
  file_name: string;
  content_type: string;
  file_size: number;
  recording_type?: RecordingType;
}

export interface CreateRecordingResponse {
  recording: Recording;
  upload_info: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
}

export interface ListRecordingsResponse {
  recordings: Recording[];
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export interface GetRecordingResponse {
  recording: Recording;
  transcript?: Transcript;
  summary?: Summary;
  audio_url?: string;
}

export interface ListTodosResponse {
  todos: Todo[];
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export interface CreateTodoRequest {
  title: string;
  description?: string;
  priority?: TodoPriority;
  due_date?: string;
  recording_id?: string;
}

export interface UpdateTodoRequest {
  title?: string;
  description?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  due_date?: string;
}

export interface AskQuestionRequest {
  question: string;
  include_context?: boolean;
}

export interface AskQuestionResponse {
  qa: QAItem;
}

export interface ListQuestionsResponse {
  questions: QAItem[];
  meta: {
    page: number;
    per_page: number;
    total: number;
  };
}

// Calendar types
export type CalendarProvider = 'google' | 'microsoft';

export interface CalendarConnection {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  provider_email: string;
  sync_enabled: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListCalendarConnectionsResponse {
  connections: CalendarConnection[];
}

export interface ConnectCalendarResponse {
  auth_url: string;
}

export interface SyncCalendarsResponse {
  synced_count: number;
  connections: CalendarConnection[];
}

// Meeting types
export type MeetingPlatform = 'zoom' | 'google_meet' | 'teams' | 'webex' | 'other';
export type MeetingStatus =
  | 'scheduled'
  | 'bot_queued'
  | 'bot_joining'
  | 'bot_in_meeting'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type MeetingSource = 'calendar' | 'manual';

export interface Meeting {
  id: string;
  user_id: string;
  calendar_event_id: string | null;
  title: string;
  platform: MeetingPlatform;
  join_url: string;
  scheduled_start: string;
  scheduled_end: string | null;
  auto_join: boolean;
  status: MeetingStatus;
  recording_id: string | null;
  source: MeetingSource;
  bot_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListMeetingsResponse {
  items: Meeting[];
  total: number;
}

export interface CreateMeetingRequest {
  title: string;
  join_url: string;
  scheduled_start: string;
  scheduled_end?: string;
  auto_join?: boolean;
  join_offset_minutes?: number;
}

export interface CreateMeetingResponse {
  meeting: Meeting;
}

export interface UpdateMeetingRequest {
  auto_join?: boolean;
  title?: string;
}

export interface UpdateMeetingResponse {
  meeting: Meeting;
}

// Live Transcript types
export interface LiveTranscriptSegment {
  id: string;
  meeting_id: string;
  bot_run_id: string;
  user_id: string;
  segment_text: string;
  speaker_id: string | null;
  speaker_name: string | null;
  is_host: boolean;
  start_timestamp: number;
  end_timestamp: number;
  words: Array<{
    text: string;
    start_timestamp: number;
    end_timestamp: number;
  }> | null;
  is_partial: boolean;
  created_at: string;
}

export interface LiveTranscriptResponse {
  segments: LiveTranscriptSegment[];
  has_more: boolean;
}

export type LiveInsightType = 'fact_check' | 'key_point' | 'question' | 'contradiction';
export type VerificationStatus = 'verified' | 'disputed' | 'false' | 'unknown';

export interface LiveInsight {
  id: string;
  meeting_id: string;
  user_id: string;
  insight_type: LiveInsightType;
  content: string;
  context: string | null;
  related_meeting_id: string | null;
  related_recording_id: string | null;
  confidence: number | null;
  verification_status: VerificationStatus | null;
  timestamp_seconds: number | null;
  created_at: string;
}

export interface LiveInsightsResponse {
  insights: LiveInsight[];
}

// Phone Call types
export type PhoneCallStatus =
  | 'initiated'
  | 'ringing'
  | 'in_progress'
  | 'recording'
  | 'completed'
  | 'failed'
  | 'busy'
  | 'no_answer'
  | 'cancelled';

export interface VerifiedPhone {
  id: string;
  phone_number: string;
  verified_at: string;
  created_at: string;
}

export interface PhoneCall {
  id: string;
  user_id: string;
  from_number: string;
  to_number: string;
  to_name: string | null;
  twilio_call_sid: string | null;
  conference_sid: string | null;
  conference_name: string | null;
  recording_sid: string | null;
  status: PhoneCallStatus;
  is_recording: boolean;
  recording_url: string | null;
  recording_duration: number | null;
  recording_id: string | null;
  started_at: string | null;
  answered_at: string | null;
  recording_started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface ListVerifiedPhonesResponse {
  phones: VerifiedPhone[];
}

export interface ListPhoneCallsResponse {
  calls: PhoneCall[];
  total: number;
  limit: number;
  offset: number;
}

export interface SendVerificationRequest {
  phone_number: string;
}

export interface CheckVerificationRequest {
  phone_number: string;
  code: string;
}

export interface CheckVerificationResponse {
  verified: boolean;
  phone: VerifiedPhone;
}

export interface InitiateCallRequest {
  from: string;
  to: string;
  to_name?: string;
}

export interface InitiateCallResponse {
  call_id: string;
  status: PhoneCallStatus;
  twilio_call_sid: string;
}

export interface StartRecordingResponse {
  recording: boolean;
  conference_name: string;
}

export interface PhoneCallResponse {
  call: PhoneCall;
}
