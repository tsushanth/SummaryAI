/**
 * API request and response types
 */

import type { Recording, Summary, Transcript } from './database.js';

// ============================================================================
// Request Types
// ============================================================================

/**
 * POST /api/recordings - Create recording request
 */
export interface CreateRecordingRequest {
  title: string;
  duration_seconds: number;
  file_size_bytes: number;
  content_type?: string;
}

/**
 * POST /api/recordings/:id/complete-upload
 */
export interface CompleteUploadRequest {
  file_size_bytes?: number;
  checksum?: string;
}

/**
 * PATCH /api/recordings/:id
 */
export interface UpdateRecordingRequest {
  title?: string;
  tags?: string[];
  is_favorite?: boolean;
}

/**
 * GET /api/recordings query parameters
 */
export interface ListRecordingsQuery {
  page?: number;
  per_page?: number;
  status?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Standard error response
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string>;
}

export interface ErrorResponse {
  error: ApiError;
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number;
  per_page: number;
  total_count: number;
  total_pages: number;
}

/**
 * Upload instructions returned after creating a recording
 */
export interface UploadInfo {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_at: string;
}

/**
 * POST /api/recordings response
 */
export interface CreateRecordingResponse {
  recording: Recording;
  upload: UploadInfo;
}

/**
 * POST /api/recordings/:id/complete-upload response
 */
export interface CompleteUploadResponse {
  recording: Recording;
  job: {
    id: string;
    status: 'queued';
    estimated_duration_seconds?: number;
  };
}

/**
 * GET /api/recordings response
 */
export interface ListRecordingsResponse {
  recordings: Recording[];
  meta: PaginationMeta;
}

/**
 * GET /api/recordings/:id response
 */
export interface GetRecordingResponse {
  recording: Recording;
  transcript?: Transcript;
  summary?: Summary;
  audio_url?: string;
  audio_url_expires_at?: string;
}

// ============================================================================
// Q&A Types
// ============================================================================

/**
 * POST /api/recordings/:id/questions request
 */
export interface AskQuestionRequest {
  question: string;
  include_context?: boolean;  // Include previous Q&A as context
}

/**
 * Citation referencing a specific part of the transcript
 */
export interface Citation {
  segment_id: string;
  timestamp: number;
  text: string;
  speaker: string;
}

/**
 * POST /api/recordings/:id/questions response
 */
export interface AskQuestionResponse {
  id: string;
  recording_id: string;
  question: string;
  answer: string;
  citations: Citation[];
  confidence: number;
  processing_time_ms: number;
  created_at: string;
}

/**
 * GET /api/recordings/:id/questions response
 */
export interface ListQuestionsResponse {
  questions: AskQuestionResponse[];
  total_count: number;
}

// ============================================================================
// Express Extensions
// ============================================================================

/**
 * Authenticated user attached to request by auth middleware
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
}

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
