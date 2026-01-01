# Summary AI - Architecture Document

## Overview

Summary AI is an iOS application that enables users to record meetings and conversations, automatically transcribe them with speaker identification, generate AI-powered summaries, and interact with their recordings through search and Q&A capabilities.

---

## 1. End-to-End Data Flow

### Recording → Upload → Processing → Storage → Display

```
1. RECORDING
   User taps record → AVAudioEngine captures audio → Saves to local .m4a file
   (Works in foreground, background, and screen-locked states)

2. UPLOAD
   Recording stops → App uploads .m4a to backend via multipart POST
   Backend streams file directly to Supabase Storage → Returns file URL
   Creates recording record in Postgres with status: "uploaded"

3. TRANSCRIPTION (Async)
   Background worker picks up job → Downloads audio from Storage
   Sends to Deepgram API (streaming upload) → Receives transcript with:
   - Word-level timestamps
   - Speaker diarization (speaker labels)
   Updates Postgres: stores transcript JSON, status: "transcribed"

4. SUMMARIZATION (Async)
   Next worker stage → Fetches transcript from Postgres
   Sends to LLM (Claude/OpenAI) with summarization prompt
   Receives: summary, key points, action items
   Updates Postgres: stores summary data, status: "completed"

5. SYNC TO DEVICE
   iOS app polls or receives push notification
   Fetches updated recording metadata + transcript + summary
   Caches locally for offline access
   User can now search, read, ask questions, and export
```

---

## 2. Backend Components

### 2.1 REST API Endpoints

```
Authentication
─────────────────────────────────────────────────────────────────
POST   /auth/register          Create account (email/password)
POST   /auth/login             Login, returns JWT
POST   /auth/magic-link        Send magic link email
POST   /auth/verify-magic      Verify magic link token
POST   /auth/refresh           Refresh access token
POST   /auth/logout            Invalidate refresh token

Recordings
─────────────────────────────────────────────────────────────────
POST   /recordings/upload      Upload audio file (multipart)
GET    /recordings             List user's recordings (paginated)
GET    /recordings/:id         Get single recording with full data
DELETE /recordings/:id         Delete recording and associated files
PATCH  /recordings/:id         Update title, tags, etc.

Transcripts & Summaries
─────────────────────────────────────────────────────────────────
GET    /recordings/:id/transcript    Get full transcript with timestamps
GET    /recordings/:id/summary       Get summary and key points

Q&A
─────────────────────────────────────────────────────────────────
POST   /recordings/:id/ask     Ask question about recording
                               Body: { question: string }
                               Returns: { answer: string, citations: [] }

Search
─────────────────────────────────────────────────────────────────
GET    /search?q=...           Search across all recordings
                               Returns matches with timestamps

Export
─────────────────────────────────────────────────────────────────
GET    /recordings/:id/export?format=txt|pdf    Download export file
```

### 2.2 Background Processing Workers

Using **Cloud Tasks** or **Pub/Sub** for job queuing:

```
┌─────────────────────────────────────────────────────────────┐
│                    JOB QUEUE SYSTEM                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Queue: transcription-jobs                                  │
│  ├── Worker: TranscriptionWorker                            │
│  │   - Polls for status: "uploaded"                         │
│  │   - Downloads audio from Supabase Storage                │
│  │   - Streams to Deepgram API                              │
│  │   - Stores transcript, updates status: "transcribed"     │
│  │   - Enqueues summarization job                           │
│  │                                                          │
│  Queue: summarization-jobs                                  │
│  ├── Worker: SummarizationWorker                            │
│  │   - Polls for status: "transcribed"                      │
│  │   - Fetches transcript from Postgres                     │
│  │   - Sends to LLM with structured prompt                  │
│  │   - Stores summary, key points, action items             │
│  │   - Updates status: "completed"                          │
│  │   - Triggers push notification to user                   │
│  │                                                          │
│  Queue: export-jobs (optional, for large PDFs)              │
│  └── Worker: ExportWorker                                   │
│      - Generates PDF from template                          │
│      - Uploads to Storage, returns signed URL               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Implementation approach:**
- Cloud Run service with separate entry points for API and workers
- Workers run as separate Cloud Run services triggered by Pub/Sub
- Retry logic with exponential backoff for API failures

### 2.3 Supabase Schema

#### Postgres Tables

```sql
-- Users (managed by Supabase Auth, extended with profile)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recordings
CREATE TABLE recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT,
    duration_seconds INTEGER,
    file_path TEXT NOT NULL,           -- Path in Supabase Storage
    file_size_bytes BIGINT,
    status TEXT NOT NULL DEFAULT 'uploading',
        -- uploading → uploaded → transcribing → transcribed
        -- → summarizing → completed | failed
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transcripts (separate for query efficiency)
CREATE TABLE transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    full_text TEXT NOT NULL,           -- Plain text for search
    segments JSONB NOT NULL,           -- Array of {start, end, text, speaker}
    word_count INTEGER,
    speaker_count INTEGER,
    language TEXT DEFAULT 'en',
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(recording_id)
);

-- Summaries
CREATE TABLE summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    key_points JSONB NOT NULL,         -- Array of strings
    action_items JSONB,                -- Array of strings (optional)
    topics JSONB,                      -- Array of detected topics
    llm_model TEXT,                    -- Track which model generated it
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(recording_id)
);

-- Q&A History (optional, for context in follow-ups)
CREATE TABLE qa_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    citations JSONB,                   -- Array of {segment_index, text}
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full-text search index
CREATE INDEX idx_transcripts_search ON transcripts
    USING GIN (to_tsvector('english', full_text));

CREATE INDEX idx_recordings_user ON recordings(user_id);
CREATE INDEX idx_recordings_status ON recordings(status);
CREATE INDEX idx_recordings_created ON recordings(created_at DESC);
```

#### Storage Buckets

```
Bucket: audio-recordings
├── /{user_id}/{recording_id}.m4a     -- Original audio files
└── Policy: Authenticated users can read/write own files

Bucket: exports
├── /{user_id}/{recording_id}.pdf     -- Generated exports
└── Policy: Signed URLs only, 1-hour expiry
```

---

## 3. iOS App Components

### 3.1 Services Layer

```
Services/
├── APIClient.swift
│   └── Central HTTP client with auth token management
│       - Request/response interceptors
│       - Automatic token refresh
│       - Error mapping to app-level errors
│
├── AuthService.swift
│   └── Authentication operations
│       - Login, register, magic link
│       - Secure token storage (Keychain)
│       - Session state management
│
├── AudioRecordingService.swift
│   └── AVAudioEngine-based recording
│       - Background audio session configuration
│       - Handles interruptions (calls, Siri)
│       - Saves to .m4a (AAC codec)
│       - Monitors recording levels for UI
│
├── RecordingsService.swift
│   └── Recording CRUD operations
│       - Upload with progress tracking
│       - Fetch list with pagination
│       - Poll for processing status
│       - Local caching with SwiftData
│
├── TranscriptService.swift
│   └── Transcript operations
│       - Fetch transcript with segments
│       - Search within transcript
│       - Jump to timestamp
│
├── QAService.swift
│   └── Question-answering
│       - Send question, receive answer
│       - Manage conversation context
│
├── SearchService.swift
│   └── Global search
│       - Search across all recordings
│       - Debounced input handling
│       - Result ranking
│
├── ExportService.swift
│   └── Export functionality
│       - Request export generation
│       - Download and share files
│
├── PushNotificationService.swift
│   └── APNs registration and handling
│       - Processing completion notifications
│
└── SyncService.swift
    └── Offline/online sync management
        - Queue uploads when offline
        - Sync on connectivity restore
```

### 3.2 View Models

```
ViewModels/
├── AuthViewModel.swift
│   └── @Observable class
│       - Login/register/logout actions
│       - Form validation
│       - Auth state: .loggedOut | .loggingIn | .loggedIn(User)
│
├── RecordingViewModel.swift
│   └── @Observable class
│       - Recording state machine
│       - Timer display
│       - Audio levels for visualization
│       - Start/pause/stop/discard actions
│
├── RecordingsListViewModel.swift
│   └── @Observable class
│       - Paginated recording list
│       - Pull-to-refresh
│       - Delete/rename actions
│       - Filter by status
│
├── RecordingDetailViewModel.swift
│   └── @Observable class
│       - Single recording with transcript + summary
│       - Playback coordination with transcript
│       - Q&A conversation state
│       - Export actions
│
├── TranscriptViewModel.swift
│   └── @Observable class
│       - Segment display with speaker labels
│       - Current segment highlighting during playback
│       - Search within transcript
│       - Timestamp navigation
│
├── SearchViewModel.swift
│   └── @Observable class
│       - Global search query
│       - Results across recordings
│       - Recent searches
│
└── SettingsViewModel.swift
    └── @Observable class
        - User profile management
        - App preferences
        - Account actions (logout, delete)
```

### 3.3 SwiftUI Views

```
Views/
├── App/
│   ├── SummaryAIApp.swift           -- App entry point
│   └── RootView.swift               -- Auth routing
│
├── Auth/
│   ├── LoginView.swift              -- Email/password login
│   ├── RegisterView.swift           -- Account creation
│   ├── MagicLinkView.swift          -- Magic link request
│   └── MagicLinkVerifyView.swift    -- Deep link handling
│
├── Recording/
│   ├── RecordButton.swift           -- Large tap-to-record button
│   ├── RecordingView.swift          -- Active recording screen
│   │   ├── Timer display
│   │   ├── Audio waveform/levels
│   │   └── Stop/pause/discard controls
│   └── RecordingProgressView.swift  -- Upload/processing status
│
├── Recordings/
│   ├── RecordingsListView.swift     -- Main list screen
│   ├── RecordingRowView.swift       -- List item component
│   └── RecordingFilterView.swift    -- Status/date filters
│
├── Detail/
│   ├── RecordingDetailView.swift    -- Container with tabs
│   ├── TranscriptTabView.swift      -- Scrollable transcript
│   ├── SummaryTabView.swift         -- Summary + key points
│   ├── QATabView.swift              -- Chat-style Q&A
│   └── AudioPlayerView.swift        -- Playback controls
│
├── Search/
│   ├── SearchView.swift             -- Search bar + results
│   └── SearchResultView.swift       -- Result with context
│
├── Export/
│   └── ExportSheet.swift            -- Format selection + share
│
├── Settings/
│   ├── SettingsView.swift           -- Settings list
│   └── ProfileView.swift            -- User profile editor
│
└── Components/
    ├── LoadingView.swift
    ├── ErrorView.swift
    ├── EmptyStateView.swift
    ├── SpeakerLabel.swift
    └── TimestampBadge.swift
```

---

## 4. System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                   iOS APP                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   SwiftUI   │  │    View     │  │  Services   ���  │    Local Storage        │ │
│  │    Views    │◄─┤   Models    │◄─┤   Layer     │◄─┤  (SwiftData + Files)    │ │
│  └─────────────┘  └─────────────┘  └──────┬──────┘  └─────────────────────────┘ │
│                                           │                                      │
└───────────────────────────────────────────┼──────────────────────────────────────┘
                                            │ HTTPS
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            GOOGLE CLOUD RUN                                      │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         API SERVICE                                       │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │   │
│  │  │  Auth   │  │Recording│  │ Search  │  │   Q&A   │  │     Export      │ │   │
│  │  │ Routes  │  │ Routes  │  │ Routes  │  │ Routes  │  │     Routes      │ │   │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘ │   │
│  │       └────────────┴────────────┴────────────┴────────────────┘          │   │
│  │                                    │                                      │   │
│  │                           ┌────────▼────────┐                            │   │
│  │                           │  LLM Provider   │                            │   │
│  │                           │   Abstraction   │                            │   │
│  │                           │  (Claude/GPT)   │                            │   │
│  │                           └─────────────────┘                            │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                      WORKER SERVICES                                      │   │
│  │  ┌────────────────────┐         ┌────────────────────┐                   │   │
│  │  │  Transcription     │         │   Summarization    │                   │   │
│  │  │     Worker         │────────►│      Worker        │                   │   │
│  │  │                    │         │                    │                   │   │
│  │  └─────────┬──────────┘         └─────────┬──────────┘                   │   │
│  │            │                              │                               │   │
│  └────────────┼──────────────────────────────┼───────────────────────────────┘   │
│               │                              │                                   │
└───────────────┼──────────────────────────────┼───────────────────────────────────┘
                │                              │
                ▼                              ▼
┌───────────────────────────┐    ┌──────────────────────────────────────────────────┐
│       DEEPGRAM API        │    │                 SUPABASE                         │
│  ┌─────────────────────┐  │    │  ┌────────────────────┐  ┌────────────────────┐  │
│  │   Speech-to-Text    │  │    │  │     POSTGRES       │  │     STORAGE        │  │
│  │   + Diarization     │  │    │  │  ┌──────────────┐  │  │  ┌──────────────┐  │  │
│  └─────────────────────┘  │    │  │  │   profiles   │  │  │  │audio-records │  │  │
└───────────────────────────┘    │  │  │  recordings  │  │  │  │   exports    │  │  │
                                 │  │  │  transcripts │  │  │  └──────────────┘  │  │
┌───────────────────────────┐    │  │  │  summaries   │  │  │                    │  │
│        LLM PROVIDER       │    │  │  │  qa_history  │  │  │                    │  │
│  ┌─────────────────────┐  │    │  │  └──────────────┘  │  │                    │  │
│  │  Claude / GPT-4     │  │    │  └────────────────────┘  └────────────────────┘  │
│  │  (via abstraction)  │  │    │                                                  │
│  └─────────────────────┘  │    │  ┌────────────────────────────────────────────┐  │
└───────────────────────────┘    │  │              SUPABASE AUTH                 │  │
                                 │  │   (JWT tokens, magic links, sessions)      │  │
                                 │  └────────────────────────────────────────────┘  │
                                 └──────────────────────────────────────────────────┘
```

---

## 5. Architectural Decisions & Tradeoffs

### 5.1 Transcription Provider: Deepgram

**Decision:** Use Deepgram over alternatives (Whisper, AssemblyAI, Google STT)

**Rationale:**
- Native speaker diarization included (no post-processing needed)
- Word-level timestamps out of the box
- Competitive pricing (~$0.0043/min for Nova-2)
- Fast processing (often faster than real-time)
- Good accuracy for conversational audio
- Simple API with streaming upload support

**Tradeoff:** Vendor lock-in, but transcription is isolated in worker.

### 5.2 Async Processing Pipeline

**Decision:** Process transcription and summarization asynchronously via job queues

**Rationale:**
- Audio processing takes 30s-5min depending on length
- Avoids HTTP timeout issues
- Allows retries on transient failures
- Better user experience (upload completes fast)
- Can scale workers independently

**Tradeoff:** More complex infrastructure, need status polling or push notifications.

### 5.3 LLM Abstraction Layer

**Decision:** Implement provider abstraction with interface:

```typescript
interface LLMProvider {
  summarize(transcript: string): Promise<SummaryResult>;
  askQuestion(transcript: string, question: string, history?: QA[]): Promise<AnswerResult>;
}
```

**Rationale:**
- Easy to swap Claude ↔ GPT-4 ↔ others
- Can A/B test providers
- Fallback on rate limits or outages
- Future-proofs against API changes

**Initial choice:** Claude 3.5 Sonnet for good balance of quality/speed/cost.

### 5.4 Recording Length Limits

**Decision:**
- Soft limit: 2 hours (warning to user)
- Hard limit: 4 hours (enforced on upload)

**Rationale:**
- 1 hour audio ≈ 50MB (AAC 128kbps)
- 4 hours ≈ 200MB, manageable for upload
- Transcription cost at 4hrs ≈ $1.00
- LLM summarization cost ≈ $0.10-0.50 depending on length
- Beyond 4 hours, should split recordings

**Implementation:**
- Enforce on iOS before upload
- Backend validates file size (200MB max)
- Worker chunks very long transcripts for LLM

### 5.5 Audio Format

**Decision:** M4A container with AAC codec, 44.1kHz mono, 128kbps

**Rationale:**
- Native iOS support (no encoding libraries needed)
- Good compression (≈1MB/minute)
- Sufficient quality for speech
- Mono is fine for meetings (saves 50% size)

### 5.6 Offline Support Strategy

**Decision:** Offline-first for recordings, online-required for Q&A

**Implementation:**
- Recordings queue locally when offline
- Auto-upload when connectivity restored
- Transcripts/summaries cached in SwiftData
- Q&A requires network (real-time LLM call)
- Search works offline on cached transcripts

### 5.7 Authentication Strategy

**Decision:** Supabase Auth with JWT, stored in iOS Keychain

**Flow:**
- Magic link (primary) - better UX, no passwords
- Email/password (fallback) - for users who prefer it
- JWT access token (1 hour expiry)
- Refresh token (30 days, stored in Keychain)
- Backend validates JWT on each request

### 5.8 Search Implementation

**Decision:** Postgres full-text search (not Elasticsearch)

**Rationale:**
- Supabase includes it free
- Sufficient for v1 scale (thousands of recordings)
- GIN index on transcript text
- Can upgrade to dedicated search later if needed

**Tradeoff:** Less sophisticated ranking than Elasticsearch, but simpler.

### 5.9 PDF Export

**Decision:** Generate server-side using Puppeteer/PDFKit

**Rationale:**
- Consistent formatting across devices
- Can include branding/styling
- Offloads work from mobile device
- Returns signed URL for download

### 5.10 Background Recording (iOS)

**Decision:** Use AVAudioSession with `.playAndRecord` category and background mode

**Requirements:**
- Enable "Audio, AirPlay, and Picture in Picture" background mode
- Configure audio session before recording starts
- Handle interruptions gracefully (calls, Siri)
- Test extensively on real devices

**Limitations:**
- iOS may terminate after ~3 minutes if truly backgrounded with screen locked
  and no active audio session
- Workaround: Keep minimal audio processing active
- User should be informed about iOS limitations

---

## 6. Cost Estimates (per recording hour)

| Service | Cost |
|---------|------|
| Deepgram Nova-2 | ~$0.26 |
| Claude 3.5 Sonnet (summary) | ~$0.05-0.15 |
| Claude 3.5 Sonnet (Q&A, avg 5 questions) | ~$0.10 |
| Supabase Storage | ~$0.02 |
| Cloud Run compute | ~$0.01 |
| **Total per hour of audio** | **~$0.45-0.55** |

---

## 7. Future Considerations (Post-v1)

- **Real-time streaming transcription** - Deepgram supports it
- **Calendar integration** - Auto-name recordings from meeting titles
- **Team/sharing features** - Share recordings within organization
- **Custom vocabulary** - Industry-specific terms
- **Integrations** - Notion, Slack, email summaries
- **Android client** - Kotlin/Compose, same backend

---

*Document version: 1.0*
*Last updated: January 2026*
