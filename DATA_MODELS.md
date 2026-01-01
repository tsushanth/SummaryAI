# Summary AI - Data Models Design

## Overview

This document defines the data models for both the iOS app (Swift) and Supabase backend (Postgres), along with the storage design and mapping between layers.

---

## 1. Swift Data Models (iOS)

### 1.1 User Model

```swift
import Foundation

/// Represents the authenticated user
struct User: Codable, Identifiable, Equatable {
    let id: UUID
    let email: String
    var displayName: String?
    let createdAt: Date
    var updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case email
        case displayName = "display_name"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// User preferences stored locally
struct UserPreferences: Codable {
    var audioQuality: AudioQuality = .standard
    var autoTitleWithAI: Bool = true
    var hasAcknowledgedRecordingConsent: Bool = false
    var defaultPlaybackSpeed: Double = 1.0

    enum AudioQuality: String, Codable, CaseIterable {
        case low = "low"           // 64 kbps, ~0.5 MB/min
        case standard = "standard" // 128 kbps, ~1 MB/min
        case high = "high"         // 256 kbps, ~2 MB/min

        var bitrate: Int {
            switch self {
            case .low: return 64_000
            case .standard: return 128_000
            case .high: return 256_000
            }
        }
    }
}
```

### 1.2 Recording Model

```swift
import Foundation
import SwiftData

/// Processing status for a recording
enum RecordingStatus: String, Codable, CaseIterable {
    case recording = "recording"       // Currently being recorded (local only)
    case pendingUpload = "pending_upload" // Recorded, waiting to upload (local only)
    case uploading = "uploading"       // Upload in progress
    case uploaded = "uploaded"         // Uploaded, waiting for transcription
    case transcribing = "transcribing" // Transcription in progress
    case transcribed = "transcribed"   // Transcribed, waiting for summarization
    case summarizing = "summarizing"   // Summary generation in progress
    case completed = "completed"       // Fully processed
    case failed = "failed"             // Processing failed

    var isProcessing: Bool {
        switch self {
        case .uploading, .transcribing, .summarizing:
            return true
        default:
            return false
        }
    }

    var isComplete: Bool {
        self == .completed
    }

    var displayName: String {
        switch self {
        case .recording: return "Recording"
        case .pendingUpload: return "Pending Upload"
        case .uploading: return "Uploading"
        case .uploaded: return "Processing"
        case .transcribing: return "Transcribing"
        case .transcribed: return "Processing"
        case .summarizing: return "Summarizing"
        case .completed: return "Completed"
        case .failed: return "Failed"
        }
    }
}

/// Main recording model - used for API responses and local cache
struct Recording: Codable, Identifiable, Hashable {
    let id: UUID
    let userId: UUID
    var title: String
    var durationSeconds: Int?
    var fileSizeBytes: Int64?
    var status: RecordingStatus
    var errorMessage: String?
    var speakerCount: Int?
    var wordCount: Int?
    var language: String?
    let createdAt: Date
    var updatedAt: Date

    // Relationships (optionally loaded)
    var transcript: Transcript?
    var summary: RecordingSummary?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case title
        case durationSeconds = "duration_seconds"
        case fileSizeBytes = "file_size_bytes"
        case status
        case errorMessage = "error_message"
        case speakerCount = "speaker_count"
        case wordCount = "word_count"
        case language
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case transcript
        case summary
    }

    // Hashable conformance (exclude relationships)
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Recording, rhs: Recording) -> Bool {
        lhs.id == rhs.id
    }
}

/// Local-only model for recordings in progress or pending upload
@Model
final class LocalRecording {
    @Attribute(.unique) var id: UUID
    var title: String
    var localFileURL: String  // Local file path
    var durationSeconds: Int
    var fileSizeBytes: Int64
    var status: String  // RecordingStatus raw value
    var createdAt: Date
    var uploadProgress: Double  // 0.0 to 1.0
    var remoteId: UUID?  // Set after successful upload

    init(
        id: UUID = UUID(),
        title: String,
        localFileURL: String,
        durationSeconds: Int,
        fileSizeBytes: Int64,
        status: RecordingStatus = .pendingUpload,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.localFileURL = localFileURL
        self.durationSeconds = durationSeconds
        self.fileSizeBytes = fileSizeBytes
        self.status = status.rawValue
        self.createdAt = createdAt
        self.uploadProgress = 0.0
        self.remoteId = nil
    }

    var recordingStatus: RecordingStatus {
        get { RecordingStatus(rawValue: status) ?? .pendingUpload }
        set { status = newValue.rawValue }
    }
}

/// Request model for creating a recording
struct CreateRecordingRequest: Codable {
    let title: String
    let durationSeconds: Int
    let fileSizeBytes: Int64

    enum CodingKeys: String, CodingKey {
        case title
        case durationSeconds = "duration_seconds"
        case fileSizeBytes = "file_size_bytes"
    }
}

/// Request model for updating a recording
struct UpdateRecordingRequest: Codable {
    var title: String?

    init(title: String? = nil) {
        self.title = title
    }
}
```

### 1.3 Transcript Models

```swift
import Foundation

/// Complete transcript for a recording
struct Transcript: Codable, Identifiable {
    let id: UUID
    let recordingId: UUID
    let fullText: String
    let segments: [TranscriptSegment]
    let wordCount: Int
    let speakerCount: Int
    let language: String
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case recordingId = "recording_id"
        case fullText = "full_text"
        case segments
        case wordCount = "word_count"
        case speakerCount = "speaker_count"
        case language
        case createdAt = "created_at"
    }
}

/// Individual segment of a transcript with timing and speaker info
struct TranscriptSegment: Codable, Identifiable, Equatable {
    let id: UUID
    let speakerLabel: String      // "Speaker 1", "Speaker 2", or actual name if available
    let speakerIndex: Int         // 0-based index for consistent coloring
    let text: String
    let startTime: Double         // Seconds from start
    let endTime: Double           // Seconds from start
    let confidence: Double?       // 0.0 to 1.0, optional
    let words: [TranscriptWord]?  // Word-level detail, optional

    enum CodingKeys: String, CodingKey {
        case id
        case speakerLabel = "speaker_label"
        case speakerIndex = "speaker_index"
        case text
        case startTime = "start_time"
        case endTime = "end_time"
        case confidence
        case words
    }

    /// Duration of this segment in seconds
    var duration: Double {
        endTime - startTime
    }

    /// Check if a given playback time falls within this segment
    func contains(time: Double) -> Bool {
        time >= startTime && time < endTime
    }
}

/// Word-level timing information (optional, for precise highlighting)
struct TranscriptWord: Codable, Equatable {
    let word: String
    let startTime: Double
    let endTime: Double
    let confidence: Double?

    enum CodingKeys: String, CodingKey {
        case word
        case startTime = "start_time"
        case endTime = "end_time"
        case confidence
    }
}

/// Search result within a transcript
struct TranscriptSearchResult: Identifiable {
    let id = UUID()
    let segment: TranscriptSegment
    let matchRange: Range<String.Index>
    let contextBefore: String
    let contextAfter: String

    var matchedText: String {
        String(segment.text[matchRange])
    }
}
```

### 1.4 Summary Models

```swift
import Foundation

/// AI-generated summary for a recording
struct RecordingSummary: Codable, Identifiable {
    let id: UUID
    let recordingId: UUID
    let summary: String
    let keyPoints: [String]
    let actionItems: [ActionItem]
    let topics: [String]
    let sentiment: Sentiment?
    let llmModel: String          // e.g., "claude-3-5-sonnet-20241022"
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case recordingId = "recording_id"
        case summary
        case keyPoints = "key_points"
        case actionItems = "action_items"
        case topics
        case sentiment
        case llmModel = "llm_model"
        case createdAt = "created_at"
    }
}

/// Action item extracted from recording
struct ActionItem: Codable, Identifiable, Equatable {
    var id: UUID { UUID() }  // Generated for Identifiable
    let text: String
    let assignee: String?         // Extracted name if mentioned
    let dueDate: String?          // Raw text like "by Friday"
    let priority: Priority?

    enum Priority: String, Codable {
        case high
        case medium
        case low
    }

    enum CodingKeys: String, CodingKey {
        case text
        case assignee
        case dueDate = "due_date"
        case priority
    }
}

/// Overall sentiment of the recording
struct Sentiment: Codable, Equatable {
    let overall: SentimentType
    let score: Double             // -1.0 (negative) to 1.0 (positive)

    enum SentimentType: String, Codable {
        case positive
        case neutral
        case negative
        case mixed
    }
}

/// Topics/themes detected in the recording (for future tagging)
struct Topic: Codable, Identifiable, Equatable {
    let id: UUID
    let name: String
    let relevanceScore: Double    // 0.0 to 1.0

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case relevanceScore = "relevance_score"
    }
}
```

### 1.5 Q&A Models

```swift
import Foundation

/// Question asked about a recording
struct QAQuestion: Codable {
    let question: String
    let includeContext: Bool      // Whether to include previous Q&A as context

    enum CodingKeys: String, CodingKey {
        case question
        case includeContext = "include_context"
    }

    init(question: String, includeContext: Bool = true) {
        self.question = question
        self.includeContext = includeContext
    }
}

/// Response from Q&A endpoint
struct QAResponse: Codable, Identifiable {
    let id: UUID
    let recordingId: UUID
    let question: String
    let answer: String
    let citations: [Citation]
    let confidence: Double?       // How confident the AI is in the answer
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case recordingId = "recording_id"
        case question
        case answer
        case citations
        case confidence
        case createdAt = "created_at"
    }
}

/// Citation referencing a specific part of the transcript
struct Citation: Codable, Equatable {
    let segmentId: UUID?          // Reference to TranscriptSegment
    let timestamp: Double         // Start time in seconds
    let text: String              // Quoted text from transcript
    let relevanceScore: Double?   // How relevant this citation is

    enum CodingKeys: String, CodingKey {
        case segmentId = "segment_id"
        case timestamp
        case text
        case relevanceScore = "relevance_score"
    }
}

/// Conversation message for display in Q&A tab
struct QAMessage: Identifiable, Equatable {
    let id: UUID
    let content: String
    let isUser: Bool
    let citations: [Citation]
    let timestamp: Date

    init(
        id: UUID = UUID(),
        content: String,
        isUser: Bool,
        citations: [Citation] = [],
        timestamp: Date = Date()
    ) {
        self.id = id
        self.content = content
        self.isUser = isUser
        self.citations = citations
        self.timestamp = timestamp
    }

    /// Create from QAResponse
    static func fromResponse(_ response: QAResponse) -> [QAMessage] {
        [
            QAMessage(
                id: UUID(),
                content: response.question,
                isUser: true,
                timestamp: response.createdAt
            ),
            QAMessage(
                id: response.id,
                content: response.answer,
                isUser: false,
                citations: response.citations,
                timestamp: response.createdAt
            )
        ]
    }
}
```

### 1.6 Search Models

```swift
import Foundation

/// Global search request
struct SearchRequest: Codable {
    let query: String
    let limit: Int
    let offset: Int

    init(query: String, limit: Int = 20, offset: Int = 0) {
        self.query = query
        self.limit = limit
        self.offset = offset
    }
}

/// Search result item
struct SearchResult: Codable, Identifiable {
    let id: UUID                  // Unique result ID
    let recordingId: UUID
    let recordingTitle: String
    let recordingDate: Date
    let matchType: MatchType
    let matchedText: String       // The text that matched
    let contextBefore: String     // Text before match
    let contextAfter: String      // Text after match
    let timestamp: Double?        // Timestamp in recording (for transcript matches)
    let relevanceScore: Double

    enum MatchType: String, Codable {
        case title                // Matched in recording title
        case transcript           // Matched in transcript text
        case summary              // Matched in summary
        case keyPoint             // Matched in key points
    }

    enum CodingKeys: String, CodingKey {
        case id
        case recordingId = "recording_id"
        case recordingTitle = "recording_title"
        case recordingDate = "recording_date"
        case matchType = "match_type"
        case matchedText = "matched_text"
        case contextBefore = "context_before"
        case contextAfter = "context_after"
        case timestamp
        case relevanceScore = "relevance_score"
    }
}

/// Search response with pagination info
struct SearchResponse: Codable {
    let results: [SearchResult]
    let totalCount: Int
    let hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case results
        case totalCount = "total_count"
        case hasMore = "has_more"
    }
}

/// Recent search stored locally
struct RecentSearch: Codable, Identifiable {
    let id: UUID
    let query: String
    let timestamp: Date
    let resultCount: Int

    init(query: String, resultCount: Int = 0) {
        self.id = UUID()
        self.query = query
        self.timestamp = Date()
        self.resultCount = resultCount
    }
}
```

### 1.7 Export Models

```swift
import Foundation

/// Export format options
enum ExportFormat: String, Codable, CaseIterable {
    case txt = "txt"
    case pdf = "pdf"
    case markdown = "md"
    case json = "json"

    var displayName: String {
        switch self {
        case .txt: return "Plain Text"
        case .pdf: return "PDF Document"
        case .markdown: return "Markdown"
        case .json: return "JSON"
        }
    }

    var fileExtension: String {
        rawValue
    }

    var mimeType: String {
        switch self {
        case .txt: return "text/plain"
        case .pdf: return "application/pdf"
        case .markdown: return "text/markdown"
        case .json: return "application/json"
        }
    }
}

/// Export configuration
struct ExportRequest: Codable {
    let format: ExportFormat
    let includeSummary: Bool
    let includeKeyPoints: Bool
    let includeActionItems: Bool
    let includeTranscript: Bool
    let includeTimestamps: Bool   // Only relevant if transcript included

    enum CodingKeys: String, CodingKey {
        case format
        case includeSummary = "include_summary"
        case includeKeyPoints = "include_key_points"
        case includeActionItems = "include_action_items"
        case includeTranscript = "include_transcript"
        case includeTimestamps = "include_timestamps"
    }

    init(
        format: ExportFormat = .pdf,
        includeSummary: Bool = true,
        includeKeyPoints: Bool = true,
        includeActionItems: Bool = true,
        includeTranscript: Bool = false,
        includeTimestamps: Bool = true
    ) {
        self.format = format
        self.includeSummary = includeSummary
        self.includeKeyPoints = includeKeyPoints
        self.includeActionItems = includeActionItems
        self.includeTranscript = includeTranscript
        self.includeTimestamps = includeTimestamps
    }
}

/// Export response with download URL
struct ExportResponse: Codable {
    let downloadURL: URL
    let expiresAt: Date
    let fileSizeBytes: Int64
    let fileName: String

    enum CodingKeys: String, CodingKey {
        case downloadURL = "download_url"
        case expiresAt = "expires_at"
        case fileSizeBytes = "file_size_bytes"
        case fileName = "file_name"
    }
}
```

### 1.8 API Response Wrappers

```swift
import Foundation

/// Generic API response wrapper
struct APIResponse<T: Codable>: Codable {
    let data: T?
    let error: APIError?
    let meta: ResponseMeta?
}

/// Pagination metadata
struct ResponseMeta: Codable {
    let page: Int
    let perPage: Int
    let totalCount: Int
    let totalPages: Int

    enum CodingKeys: String, CodingKey {
        case page
        case perPage = "per_page"
        case totalCount = "total_count"
        case totalPages = "total_pages"
    }

    var hasNextPage: Bool {
        page < totalPages
    }
}

/// API error response
struct APIError: Codable, Error {
    let code: String
    let message: String
    let details: [String: String]?

    static let unknown = APIError(
        code: "UNKNOWN_ERROR",
        message: "An unknown error occurred",
        details: nil
    )
}

/// Paginated list response
struct PaginatedResponse<T: Codable>: Codable {
    let items: [T]
    let meta: ResponseMeta
}
```

---

## 2. Supabase Schema (Postgres)

### 2.1 Complete SQL DDL

```sql
-- ============================================================================
-- Summary AI - Database Schema
-- ============================================================================
--
-- This schema supports:
-- - Multiple recordings per user
-- - Long transcripts with many segments (stored as JSONB for efficiency)
-- - Full-text search across transcripts
-- - Q&A history for context in follow-up questions
-- - Future expansion (tags, sharing, etc.)
--
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy text search

-- ============================================================================
-- PROFILES TABLE
-- ============================================================================
-- Extends Supabase Auth with additional user data
-- Links to auth.users via foreign key

CREATE TABLE profiles (
    -- Primary key matches auth.users.id
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

    -- User info
    email TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,

    -- Preferences (stored as JSONB for flexibility)
    preferences JSONB DEFAULT '{
        "audio_quality": "standard",
        "auto_title_with_ai": true,
        "default_playback_speed": 1.0
    }'::jsonb,

    -- Consent tracking
    recording_consent_acknowledged_at TIMESTAMPTZ,
    terms_accepted_at TIMESTAMPTZ,
    privacy_policy_accepted_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for email lookups
CREATE INDEX idx_profiles_email ON profiles(email);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile when user signs up
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();


-- ============================================================================
-- RECORDINGS TABLE
-- ============================================================================
-- Core table for storing recording metadata

CREATE TYPE recording_status AS ENUM (
    'uploading',
    'uploaded',
    'transcribing',
    'transcribed',
    'summarizing',
    'completed',
    'failed'
);

CREATE TABLE recordings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Basic info
    title TEXT NOT NULL,
    duration_seconds INTEGER,
    file_size_bytes BIGINT,

    -- Storage reference
    file_path TEXT NOT NULL,              -- Path in Supabase Storage

    -- Processing status
    status recording_status NOT NULL DEFAULT 'uploading',
    error_message TEXT,
    error_code TEXT,

    -- Metadata extracted during processing
    speaker_count INTEGER,
    word_count INTEGER,
    language TEXT DEFAULT 'en',

    -- For future features
    tags TEXT[] DEFAULT '{}',             -- Array of tag strings
    is_favorite BOOLEAN DEFAULT FALSE,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,             -- When processing completed

    -- Constraints
    CONSTRAINT valid_duration CHECK (duration_seconds IS NULL OR duration_seconds > 0),
    CONSTRAINT valid_file_size CHECK (file_size_bytes IS NULL OR file_size_bytes > 0)
);

-- Indexes for common queries
CREATE INDEX idx_recordings_user_id ON recordings(user_id);
CREATE INDEX idx_recordings_status ON recordings(status);
CREATE INDEX idx_recordings_created_at ON recordings(created_at DESC);
CREATE INDEX idx_recordings_user_created ON recordings(user_id, created_at DESC);
CREATE INDEX idx_recordings_tags ON recordings USING GIN(tags);

-- Trigger for updated_at
CREATE TRIGGER update_recordings_updated_at
    BEFORE UPDATE ON recordings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- TRANSCRIPTS TABLE
-- ============================================================================
-- Stores transcript data with segments as JSONB for efficient querying
-- Separate table allows for re-transcription without affecting recordings

CREATE TABLE transcripts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,

    -- Plain text for full-text search
    full_text TEXT NOT NULL,

    -- Segments stored as JSONB array
    -- Each segment: {id, speaker_label, speaker_index, text, start_time, end_time, confidence, words}
    segments JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Metadata
    word_count INTEGER NOT NULL DEFAULT 0,
    speaker_count INTEGER NOT NULL DEFAULT 0,
    language TEXT NOT NULL DEFAULT 'en',

    -- Processing info
    transcription_provider TEXT,          -- e.g., 'deepgram'
    transcription_model TEXT,             -- e.g., 'nova-2'
    processing_duration_ms INTEGER,       -- How long transcription took

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One transcript per recording
    CONSTRAINT unique_recording_transcript UNIQUE(recording_id)
);

-- Full-text search index
CREATE INDEX idx_transcripts_fulltext ON transcripts
    USING GIN(to_tsvector('english', full_text));

-- Trigram index for fuzzy search
CREATE INDEX idx_transcripts_trgm ON transcripts
    USING GIN(full_text gin_trgm_ops);

-- Index for recording lookup
CREATE INDEX idx_transcripts_recording_id ON transcripts(recording_id);


-- ============================================================================
-- SUMMARIES TABLE
-- ============================================================================
-- AI-generated summaries, key points, and action items

CREATE TABLE summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,

    -- Summary content
    summary TEXT NOT NULL,

    -- Key points as JSONB array of strings
    key_points JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Action items as JSONB array of objects
    -- Each item: {text, assignee?, due_date?, priority?}
    action_items JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Topics/themes as JSONB array of strings
    topics JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Sentiment analysis (optional)
    -- Format: {overall: "positive"|"neutral"|"negative"|"mixed", score: -1.0 to 1.0}
    sentiment JSONB,

    -- Processing info
    llm_provider TEXT,                    -- e.g., 'anthropic'
    llm_model TEXT,                       -- e.g., 'claude-3-5-sonnet-20241022'
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    processing_duration_ms INTEGER,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One summary per recording
    CONSTRAINT unique_recording_summary UNIQUE(recording_id)
);

-- Index for recording lookup
CREATE INDEX idx_summaries_recording_id ON summaries(recording_id);

-- Full-text search on summary
CREATE INDEX idx_summaries_fulltext ON summaries
    USING GIN(to_tsvector('english', summary));


-- ============================================================================
-- QA_HISTORY TABLE
-- ============================================================================
-- Stores Q&A interactions for context in follow-up questions

CREATE TABLE qa_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Q&A content
    question TEXT NOT NULL,
    answer TEXT NOT NULL,

    -- Citations as JSONB array
    -- Each citation: {segment_id?, timestamp, text, relevance_score?}
    citations JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Confidence score (0.0 to 1.0)
    confidence DOUBLE PRECISION,

    -- Processing info
    llm_provider TEXT,
    llm_model TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    processing_duration_ms INTEGER,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_qa_history_recording_id ON qa_history(recording_id);
CREATE INDEX idx_qa_history_user_id ON qa_history(user_id);
CREATE INDEX idx_qa_history_created_at ON qa_history(created_at DESC);

-- Composite index for fetching Q&A history for a recording
CREATE INDEX idx_qa_history_recording_created ON qa_history(recording_id, created_at ASC);


-- ============================================================================
-- SEARCH_INDEX TABLE (Materialized View Alternative)
-- ============================================================================
-- Denormalized table for efficient global search
-- Updated via triggers when recordings/transcripts/summaries change

CREATE TABLE search_index (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Searchable content (combined for ranking)
    title TEXT NOT NULL,
    transcript_text TEXT,
    summary_text TEXT,
    key_points_text TEXT,                 -- Concatenated key points

    -- Combined search vector
    search_vector TSVECTOR,

    -- Recording metadata for display
    recording_date TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER,
    status recording_status NOT NULL,

    -- Timestamps
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_search_index_recording UNIQUE(recording_id)
);

-- GIN index for full-text search
CREATE INDEX idx_search_index_vector ON search_index USING GIN(search_vector);

-- Index for user filtering
CREATE INDEX idx_search_index_user ON search_index(user_id);

-- Function to update search index
CREATE OR REPLACE FUNCTION update_search_index()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search_index (
        recording_id,
        user_id,
        title,
        transcript_text,
        summary_text,
        key_points_text,
        search_vector,
        recording_date,
        duration_seconds,
        status
    )
    SELECT
        r.id,
        r.user_id,
        r.title,
        t.full_text,
        s.summary,
        array_to_string(
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(s.key_points, '[]'::jsonb))),
            ' '
        ),
        setweight(to_tsvector('english', COALESCE(r.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(s.summary, '')), 'B') ||
        setweight(to_tsvector('english',
            array_to_string(
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(s.key_points, '[]'::jsonb))),
                ' '
            )
        ), 'B') ||
        setweight(to_tsvector('english', COALESCE(t.full_text, '')), 'C'),
        r.created_at,
        r.duration_seconds,
        r.status
    FROM recordings r
    LEFT JOIN transcripts t ON t.recording_id = r.id
    LEFT JOIN summaries s ON s.recording_id = r.id
    WHERE r.id = COALESCE(NEW.recording_id, NEW.id)
    ON CONFLICT (recording_id)
    DO UPDATE SET
        title = EXCLUDED.title,
        transcript_text = EXCLUDED.transcript_text,
        summary_text = EXCLUDED.summary_text,
        key_points_text = EXCLUDED.key_points_text,
        search_vector = EXCLUDED.search_vector,
        recording_date = EXCLUDED.recording_date,
        duration_seconds = EXCLUDED.duration_seconds,
        status = EXCLUDED.status,
        indexed_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to keep search index updated
CREATE TRIGGER update_search_index_on_recording
    AFTER INSERT OR UPDATE ON recordings
    FOR EACH ROW
    EXECUTE FUNCTION update_search_index();

CREATE TRIGGER update_search_index_on_transcript
    AFTER INSERT OR UPDATE ON transcripts
    FOR EACH ROW
    EXECUTE FUNCTION update_search_index();

CREATE TRIGGER update_search_index_on_summary
    AFTER INSERT OR UPDATE ON summaries
    FOR EACH ROW
    EXECUTE FUNCTION update_search_index();


-- ============================================================================
-- TAGS TABLE (For Future Use)
-- ============================================================================
-- Normalized tags for consistent tagging across recordings

CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,                           -- Hex color for UI
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique tag name per user
    CONSTRAINT unique_user_tag UNIQUE(user_id, name)
);

CREATE INDEX idx_tags_user_id ON tags(user_id);

-- Junction table for recording-tag relationship
CREATE TABLE recording_tags (
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (recording_id, tag_id)
);

CREATE INDEX idx_recording_tags_tag_id ON recording_tags(tag_id);


-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_tags ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can only access their own profile
CREATE POLICY profiles_select ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY profiles_update ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Recordings: Users can only access their own recordings
CREATE POLICY recordings_select ON recordings
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY recordings_insert ON recordings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY recordings_update ON recordings
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY recordings_delete ON recordings
    FOR DELETE USING (auth.uid() = user_id);

-- Transcripts: Access via recording ownership
CREATE POLICY transcripts_select ON transcripts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM recordings
            WHERE recordings.id = transcripts.recording_id
            AND recordings.user_id = auth.uid()
        )
    );

-- Summaries: Access via recording ownership
CREATE POLICY summaries_select ON summaries
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM recordings
            WHERE recordings.id = summaries.recording_id
            AND recordings.user_id = auth.uid()
        )
    );

-- QA History: Users can only access their own Q&A
CREATE POLICY qa_history_select ON qa_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY qa_history_insert ON qa_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Search Index: Users can only search their own recordings
CREATE POLICY search_index_select ON search_index
    FOR SELECT USING (auth.uid() = user_id);

-- Tags: Users can only access their own tags
CREATE POLICY tags_all ON tags
    FOR ALL USING (auth.uid() = user_id);

-- Recording Tags: Access via recording ownership
CREATE POLICY recording_tags_all ON recording_tags
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM recordings
            WHERE recordings.id = recording_tags.recording_id
            AND recordings.user_id = auth.uid()
        )
    );


-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to search recordings
CREATE OR REPLACE FUNCTION search_recordings(
    search_query TEXT,
    user_uuid UUID,
    result_limit INTEGER DEFAULT 20,
    result_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    recording_id UUID,
    title TEXT,
    recording_date TIMESTAMPTZ,
    duration_seconds INTEGER,
    match_type TEXT,
    matched_text TEXT,
    rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        si.recording_id,
        si.title,
        si.recording_date,
        si.duration_seconds,
        CASE
            WHEN si.title ILIKE '%' || search_query || '%' THEN 'title'
            WHEN si.summary_text ILIKE '%' || search_query || '%' THEN 'summary'
            WHEN si.key_points_text ILIKE '%' || search_query || '%' THEN 'key_point'
            ELSE 'transcript'
        END AS match_type,
        ts_headline('english',
            COALESCE(si.title || ' ', '') ||
            COALESCE(si.summary_text || ' ', '') ||
            COALESCE(si.transcript_text, ''),
            plainto_tsquery('english', search_query),
            'MaxWords=30, MinWords=15, StartSel=<<, StopSel=>>'
        ) AS matched_text,
        ts_rank(si.search_vector, plainto_tsquery('english', search_query)) AS rank
    FROM search_index si
    WHERE si.user_id = user_uuid
        AND si.search_vector @@ plainto_tsquery('english', search_query)
        AND si.status = 'completed'
    ORDER BY rank DESC
    LIMIT result_limit
    OFFSET result_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get recording with all related data
CREATE OR REPLACE FUNCTION get_recording_full(recording_uuid UUID)
RETURNS TABLE (
    recording JSONB,
    transcript JSONB,
    summary JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        to_jsonb(r.*) AS recording,
        to_jsonb(t.*) AS transcript,
        to_jsonb(s.*) AS summary
    FROM recordings r
    LEFT JOIN transcripts t ON t.recording_id = r.id
    LEFT JOIN summaries s ON s.recording_id = r.id
    WHERE r.id = recording_uuid
        AND r.user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 3. Supabase Storage Design

### 3.1 Bucket Configuration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SUPABASE STORAGE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Bucket: recordings-audio                                                   │
│  ├── Purpose: Store original audio files                                    │
│  ├── Public: No (private bucket)                                            │
│  ├── File size limit: 200 MB                                                │
│  ├── Allowed MIME types: audio/mp4, audio/x-m4a, audio/mpeg, audio/wav     │
│  └── Structure:                                                             │
│      └── {user_id}/                                                         │
│          └── {recording_id}.m4a                                             │
│                                                                             │
│  Bucket: exports                                                            │
│  ├── Purpose: Store generated export files (PDF, etc.)                      │
│  ├── Public: No (private bucket)                                            │
│  ├── File size limit: 50 MB                                                 │
│  ├── Allowed MIME types: application/pdf, text/plain, text/markdown         │
│  ├── Auto-delete: 24 hours (exports are temporary)                          │
│  └── Structure:                                                             │
│      └── {user_id}/                                                         │
│          └── {recording_id}/                                                │
│              └── {export_id}.{format}                                       │
│                                                                             │
│  Bucket: avatars (future)                                                   │
│  ├── Purpose: User profile pictures                                         │
│  ├── Public: Yes (public bucket)                                            │
│  ├── File size limit: 5 MB                                                  │
│  └── Structure:                                                             │
│      └── {user_id}.{ext}                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Storage Policies (SQL)

```sql
-- ============================================================================
-- STORAGE BUCKET CONFIGURATION
-- ============================================================================

-- Create buckets (run in Supabase dashboard or via API)
-- Note: Bucket creation is typically done via dashboard

-- recordings-audio bucket policies
CREATE POLICY "Users can upload their own audio files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'recordings-audio' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can read their own audio files"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'recordings-audio' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own audio files"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'recordings-audio' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- exports bucket policies
CREATE POLICY "Users can read their own exports"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'exports' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- Service role can write exports (backend generates them)
CREATE POLICY "Service can create exports"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'exports');
```

### 3.3 File Naming Convention

```
Audio Files:
────────────────────────────────────────────────────────────────
Path: recordings-audio/{user_id}/{recording_id}.m4a

Example:
recordings-audio/123e4567-e89b-12d3-a456-426614174000/987fcdeb-51a2-34bc-def0-123456789abc.m4a

Rationale:
- User ID first enables efficient per-user queries and cleanup
- Recording ID matches database record
- Single extension (.m4a) simplifies handling

Export Files:
────────────────────────────────────────────────────────────────
Path: exports/{user_id}/{recording_id}/{export_id}.{format}

Example:
exports/123e4567-e89b-12d3-a456-426614174000/987fcdeb-51a2-34bc-def0-123456789abc/abc123.pdf

Rationale:
- Allows multiple exports per recording
- Export ID enables tracking in case of regeneration
- Format in extension for easy identification
```

---

## 4. iOS to Supabase Mapping

### 4.1 Model Mapping Table

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     iOS MODEL → SUPABASE TABLE MAPPING                      │
├────────────────────┬────────────────────┬───────────────────────────────────┤
│ Swift Model        │ Postgres Table     │ Notes                             │
├────────────────────┼────────────────────┼───────────────────────────────────┤
│ User               │ profiles           │ id from auth.users                │
│ UserPreferences    │ profiles.prefs     │ Stored in JSONB column            │
│ Recording          │ recordings         │ Direct 1:1 mapping                │
│ LocalRecording     │ (local only)       │ SwiftData, synced after upload    │
│ Transcript         │ transcripts        │ segments as JSONB                 │
│ TranscriptSegment  │ transcripts.segs   │ Nested in JSONB array             │
│ RecordingSummary   │ summaries          │ key_points/action_items as JSONB  │
│ ActionItem         │ summaries.action_* │ Nested in JSONB array             │
│ QAResponse         │ qa_history         │ citations as JSONB                │
│ Citation           │ qa_history.cites   │ Nested in JSONB array             │
│ SearchResult       │ search_index       │ Via search_recordings() function  │
│ Tag                │ tags               │ For future use                    │
└────────────────────┴────────────────────┴───────────────────────────────────┘
```

### 4.2 Data Flow Diagrams

```
UPLOAD FLOW
────────────────────────────────────────────────────────────────

iOS App                          Backend                    Supabase
───────                          ───────                    ────────
   │                                │                           │
   │  1. Create LocalRecording      │                           │
   │     (SwiftData)                │                           │
   │                                │                           │
   │  2. POST /recordings/upload    │                           │
   │     + multipart audio ─────────►                           │
   │                                │  3. Upload to Storage     │
   │                                │     ──────────────────────►
   │                                │                           │
   │                                │  4. INSERT recordings     │
   │                                │     status: 'uploaded'    │
   │                                │     ──────────────────────►
   │                                │                           │
   │  5. Response: Recording ◄──────│                           │
   │     (id, status, file_path)    │                           │
   │                                │                           │
   │  6. Update LocalRecording      │                           │
   │     (remoteId = id)            │                           │
   │                                │                           │


FETCH FLOW
────────────────────────────────────────────────────────────────

iOS App                          Backend                    Supabase
───────                          ───────                    ────────
   │                                │                           │
   │  1. GET /recordings ───────────►                           │
   │                                │  2. SELECT recordings     │
   │                                │     WHERE user_id = ?     │
   │                                │     ──────────────────────►
   │                                │                           │
   │                                │  3. Results ◄─────────────│
   │                                │                           │
   │  4. [Recording] ◄──────────────│                           │
   │                                │                           │
   │  5. Cache in SwiftData         │                           │
   │                                │                           │


DETAIL FETCH FLOW (with transcript + summary)
────────────────────────────────────────────────────────────────

iOS App                          Backend                    Supabase
───────                          ───────                    ────────
   │                                │                           │
   │  1. GET /recordings/:id ───────►                           │
   │     ?include=transcript,       │                           │
   │              summary           │                           │
   │                                │  2. SELECT with JOINs     │
   │                                │     or get_recording_full │
   │                                │     ──────────────────────►
   │                                │                           │
   │                                │  3. Results ◄─────────────│
   │                                │                           │
   │  4. Recording with nested ◄────│                           │
   │     transcript + summary       │                           │
   │                                │                           │
```

### 4.3 JSON Decoding Strategy

```swift
// Custom date decoding for Supabase timestamps
extension JSONDecoder {
    static var supabase: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let dateString = try container.decode(String.self)

            // Try ISO8601 with fractional seconds
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: dateString) {
                return date
            }

            // Fallback to without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: dateString) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode date: \(dateString)"
            )
        }
        return decoder
    }
}

// Usage
let recording = try JSONDecoder.supabase.decode(Recording.self, from: data)
```

### 4.4 Offline Sync Strategy

```swift
/// Sync manager handles offline-first data flow
actor SyncManager {

    /// Sync state for a recording
    enum SyncState {
        case synced              // Matches server
        case localOnly           // Not yet uploaded
        case pendingUpload       // Queued for upload
        case uploading           // Currently uploading
        case pendingDownload     // Server has updates
        case conflict            // Local and server differ
    }

    /// Queue pending uploads when online
    func syncPendingUploads() async {
        let pendingRecordings = await localStore.fetchPending()

        for local in pendingRecordings {
            do {
                let remote = try await apiClient.uploadRecording(local)
                await localStore.markSynced(local.id, remoteId: remote.id)
            } catch {
                // Keep in queue, will retry later
                await localStore.markFailed(local.id, error: error)
            }
        }
    }

    /// Pull latest from server
    func pullRemoteChanges() async {
        let lastSync = await localStore.lastSyncTimestamp
        let changes = try? await apiClient.getRecordingsSince(lastSync)

        for recording in changes ?? [] {
            await localStore.upsert(recording)
        }

        await localStore.updateLastSync(Date())
    }
}
```

---

## 5. Design Considerations

### 5.1 Scalability

**Transcript Storage:**
- Segments stored as JSONB array rather than separate rows
- Avoids thousands of rows for long recordings
- JSONB is efficient for read-heavy workloads
- Can still query into JSONB if needed

**Search:**
- Dedicated `search_index` table with pre-computed tsvector
- Updated via triggers (eventual consistency is acceptable)
- Weighted search: title (A) > summary (B) > transcript (C)

**Pagination:**
- All list endpoints use cursor-based pagination
- `created_at DESC` as default sort
- Indexes support efficient pagination

### 5.2 Future Expansion

**Tags System:**
- `tags` table and `recording_tags` junction table ready
- Can be enabled without schema changes
- JSONB `tags` array on recordings for denormalized quick access

**Sharing (Future):**
```sql
-- Prepared for future sharing feature
CREATE TABLE shared_recordings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recording_id UUID REFERENCES recordings(id) ON DELETE CASCADE,
    shared_by UUID REFERENCES profiles(id),
    shared_with UUID REFERENCES profiles(id),  -- NULL for link sharing
    share_token TEXT UNIQUE,                    -- For link sharing
    permissions TEXT[] DEFAULT '{view}',        -- view, comment, edit
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Teams (Future):**
```sql
-- Prepared for future team feature
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    owner_id UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE team_members (
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',  -- owner, admin, member
    PRIMARY KEY (team_id, user_id)
);

-- Add team_id to recordings for team recordings
-- ALTER TABLE recordings ADD COLUMN team_id UUID REFERENCES teams(id);
```

### 5.3 Data Retention

```sql
-- Function to clean up old exports (run daily via cron)
CREATE OR REPLACE FUNCTION cleanup_old_exports()
RETURNS void AS $$
BEGIN
    -- Delete export files older than 24 hours
    -- Actual file deletion happens via Storage API
    DELETE FROM storage.objects
    WHERE bucket_id = 'exports'
    AND created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to anonymize deleted user data (GDPR compliance)
CREATE OR REPLACE FUNCTION anonymize_user_data(user_uuid UUID)
RETURNS void AS $$
BEGIN
    -- Delete all recordings (cascades to transcripts, summaries, etc.)
    DELETE FROM recordings WHERE user_id = user_uuid;

    -- Delete Q&A history
    DELETE FROM qa_history WHERE user_id = user_uuid;

    -- Delete tags
    DELETE FROM tags WHERE user_id = user_uuid;

    -- Anonymize profile (keep for audit, remove PII)
    UPDATE profiles
    SET email = 'deleted_' || user_uuid::text || '@deleted.local',
        display_name = NULL,
        avatar_url = NULL,
        preferences = '{}'::jsonb
    WHERE id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

*Document version: 1.0*
*Last updated: January 2026*
