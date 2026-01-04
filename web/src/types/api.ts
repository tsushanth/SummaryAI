// Recording types
export type RecordingStatus =
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
