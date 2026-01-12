/**
 * Database types for Supabase
 * These types mirror the Postgres schema defined in DATA_MODELS.md
 */

// Recording status enum matching Postgres
export type RecordingStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'transcribing'
  | 'transcribed'
  | 'summarizing'
  | 'completed'
  | 'failed';

/**
 * Profile (extends Supabase Auth user)
 */
export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  preferences: UserPreferences;
  recording_consent_acknowledged_at: string | null;
  terms_accepted_at: string | null;
  privacy_policy_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  audio_quality: 'low' | 'standard' | 'high';
  auto_title_with_ai: boolean;
  default_playback_speed: number;
}

/**
 * Recording
 */
export interface Recording {
  id: string;
  user_id: string;
  title: string;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  file_path: string | null;
  status: RecordingStatus;
  error_message: string | null;
  error_code: string | null;
  speaker_count: number | null;
  word_count: number | null;
  language: string | null;
  tags: string[];
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
  meeting_id: string | null;
}

export type RecordingInsert = Omit<Recording, 'id' | 'created_at' | 'updated_at'>;
export type RecordingUpdate = Partial<Omit<Recording, 'id' | 'user_id' | 'created_at'>>;

/**
 * Transcript segment stored in JSONB
 */
export interface TranscriptSegment {
  id: string;
  speaker_label: string;
  speaker_index: number;
  text: string;
  start_time: number;
  end_time: number;
  confidence: number;
  words?: TranscriptWord[];
}

export interface TranscriptWord {
  word: string;
  start_time: number;
  end_time: number;
  confidence: number;
}

/**
 * Transcript
 */
export interface Transcript {
  id: string;
  recording_id: string;
  full_text: string;
  segments: TranscriptSegment[];
  word_count: number;
  speaker_count: number;
  language: string;
  transcription_provider: string | null;
  transcription_model: string | null;
  processing_duration_ms: number | null;
  created_at: string;
  /** Maps speaker_index (as string) to custom speaker name */
  speaker_names?: Record<string, string>;
}

/**
 * Action item in summary
 */
export interface ActionItem {
  text: string;
  assignee: string | null;
  due_date: string | null;
  priority: 'high' | 'medium' | 'low' | null;
}

/**
 * Sentiment analysis result
 */
export interface Sentiment {
  overall: 'positive' | 'neutral' | 'negative' | 'mixed';
  score: number;
}

/**
 * Summary
 */
export interface Summary {
  id: string;
  recording_id: string;
  summary: string;
  key_points: string[];
  action_items: ActionItem[];
  topics: string[];
  sentiment: Sentiment | null;
  llm_provider: string | null;
  llm_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  processing_duration_ms: number | null;
  created_at: string;
}

/**
 * Q&A History
 */
export interface QAHistory {
  id: string;
  recording_id: string;
  user_id: string;
  question: string;
  answer: string;
  citations: Citation[];
  confidence: number | null;
  llm_provider: string | null;
  llm_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  processing_duration_ms: number | null;
  created_at: string;
}

export interface Citation {
  segment_id: string | null;
  timestamp: number;
  text: string;
  relevance_score: number | null;
}

/**
 * Supabase Database schema type
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>;
      };
      recordings: {
        Row: Recording;
        Insert: RecordingInsert;
        Update: RecordingUpdate;
      };
      transcripts: {
        Row: Transcript;
        Insert: Omit<Transcript, 'id' | 'created_at'>;
        Update: Partial<Omit<Transcript, 'id' | 'recording_id' | 'created_at'>>;
      };
      summaries: {
        Row: Summary;
        Insert: Omit<Summary, 'id' | 'created_at'>;
        Update: Partial<Omit<Summary, 'id' | 'recording_id' | 'created_at'>>;
      };
      qa_history: {
        Row: QAHistory;
        Insert: Omit<QAHistory, 'id' | 'created_at'>;
        Update: never;
      };
    };
  };
}
