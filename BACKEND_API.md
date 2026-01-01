# Summary AI - Backend API Design

## Overview

The backend is a Node.js/TypeScript Express API deployed on Google Cloud Run. It handles authentication, file uploads, orchestrates async processing (transcription + summarization), and serves data to the iOS app.

---

## 1. API Endpoints

### Base URL
```
Production: https://api.summaryai.app/v1
Staging:    https://api-staging.summaryai.app/v1
```

### Authentication
All endpoints except `/auth/*` require a valid JWT in the `Authorization` header:
```
Authorization: Bearer <supabase_access_token>
```

---

### 1.1 Authentication Endpoints

#### POST /auth/register
Create a new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (201 Created):**
```json
{
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "created_at": "2026-01-15T10:30:00.000Z"
  },
  "session": {
    "access_token": "eyJhbG...",
    "refresh_token": "v1.MjE...",
    "expires_at": "2026-01-15T11:30:00.000Z"
  }
}
```

**Errors:**
- `400` - Invalid email or weak password
- `409` - Email already registered

---

#### POST /auth/login
Authenticate with email and password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200 OK):**
```json
{
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "display_name": "John Doe",
    "created_at": "2026-01-15T10:30:00.000Z"
  },
  "session": {
    "access_token": "eyJhbG...",
    "refresh_token": "v1.MjE...",
    "expires_at": "2026-01-15T11:30:00.000Z"
  }
}
```

**Errors:**
- `401` - Invalid credentials

---

#### POST /auth/magic-link
Request a magic link for passwordless login.

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "message": "Magic link sent to email"
}
```

**Errors:**
- `400` - Invalid email format
- `429` - Too many requests (rate limited)

---

#### POST /auth/verify-magic-link
Verify magic link token (called when user clicks link).

**Request:**
```json
{
  "token": "pkce_verifier_token",
  "token_hash": "hashed_token_from_url"
}
```

**Response (200 OK):**
```json
{
  "user": { ... },
  "session": { ... }
}
```

---

#### POST /auth/refresh
Refresh an expired access token.

**Request:**
```json
{
  "refresh_token": "v1.MjE..."
}
```

**Response (200 OK):**
```json
{
  "session": {
    "access_token": "eyJhbG...",
    "refresh_token": "v1.MjE...",
    "expires_at": "2026-01-15T12:30:00.000Z"
  }
}
```

**Errors:**
- `401` - Invalid or expired refresh token

---

#### POST /auth/logout
Invalidate current session.

**Request:** (empty body, uses token from header)

**Response (200 OK):**
```json
{
  "message": "Logged out successfully"
}
```

---

#### GET /auth/me
Get current user profile.

**Response (200 OK):**
```json
{
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "display_name": "John Doe",
    "preferences": {
      "audio_quality": "standard",
      "auto_title_with_ai": true,
      "default_playback_speed": 1.0
    },
    "created_at": "2026-01-15T10:30:00.000Z",
    "updated_at": "2026-01-15T10:30:00.000Z"
  }
}
```

---

#### PATCH /auth/me
Update current user profile.

**Request:**
```json
{
  "display_name": "John D.",
  "preferences": {
    "audio_quality": "high"
  }
}
```

**Response (200 OK):**
```json
{
  "user": { ... }
}
```

---

### 1.2 Recording Endpoints

#### POST /recordings
Create a new recording and get a presigned upload URL.

**Request:**
```json
{
  "title": "Team Standup Meeting",
  "duration_seconds": 1423,
  "file_size_bytes": 8567234,
  "content_type": "audio/mp4"
}
```

**Response (201 Created):**
```json
{
  "recording": {
    "id": "987fcdeb-51a2-34bc-def0-123456789abc",
    "user_id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Team Standup Meeting",
    "duration_seconds": 1423,
    "file_size_bytes": 8567234,
    "status": "uploading",
    "file_path": "123e4567-e89b-12d3-a456-426614174000/987fcdeb-51a2-34bc-def0-123456789abc.m4a",
    "created_at": "2026-01-15T10:30:00.000Z",
    "updated_at": "2026-01-15T10:30:00.000Z"
  },
  "upload": {
    "url": "https://xyz.supabase.co/storage/v1/object/upload/sign/recordings-audio/...",
    "method": "PUT",
    "headers": {
      "Content-Type": "audio/mp4",
      "x-upsert": "true"
    },
    "expires_at": "2026-01-15T11:30:00.000Z"
  }
}
```

**Errors:**
- `400` - Invalid request (missing fields, invalid duration)
- `413` - File too large (>200MB)

---

#### POST /recordings/:id/upload-complete
Signal that audio upload is complete and start processing.

**Request:**
```json
{
  "file_size_bytes": 8567234,
  "checksum": "sha256:abc123..."
}
```

**Response (200 OK):**
```json
{
  "recording": {
    "id": "987fcdeb-51a2-34bc-def0-123456789abc",
    "status": "uploaded",
    "updated_at": "2026-01-15T10:31:00.000Z"
  },
  "job": {
    "id": "job-456",
    "status": "queued",
    "estimated_duration_seconds": 120
  }
}
```

**Errors:**
- `404` - Recording not found
- `409` - Recording not in 'uploading' status
- `422` - File verification failed (size mismatch or missing)

---

#### GET /recordings
List recordings for the current user.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number |
| `per_page` | integer | 20 | Items per page (max 50) |
| `status` | string | - | Filter by status |
| `sort` | string | `created_at` | Sort field |
| `order` | string | `desc` | Sort order (asc/desc) |

**Response (200 OK):**
```json
{
  "recordings": [
    {
      "id": "987fcdeb-51a2-34bc-def0-123456789abc",
      "title": "Team Standup Meeting",
      "duration_seconds": 1423,
      "file_size_bytes": 8567234,
      "status": "completed",
      "speaker_count": 4,
      "word_count": 2847,
      "language": "en",
      "created_at": "2026-01-15T10:30:00.000Z",
      "updated_at": "2026-01-15T10:35:00.000Z"
    },
    {
      "id": "abc12345-6789-0def-ghij-klmnopqrstuv",
      "title": "Client Call",
      "duration_seconds": 2700,
      "status": "transcribing",
      "created_at": "2026-01-15T09:00:00.000Z",
      "updated_at": "2026-01-15T09:02:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 20,
    "total_count": 42,
    "total_pages": 3
  }
}
```

---

#### GET /recordings/:id
Get full recording details with optional includes.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `include` | string | Comma-separated: `transcript`, `summary`, `qa_history` |

**Response (200 OK):**
```json
{
  "recording": {
    "id": "987fcdeb-51a2-34bc-def0-123456789abc",
    "user_id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Team Standup Meeting",
    "duration_seconds": 1423,
    "file_size_bytes": 8567234,
    "file_path": "123e4567.../987fcdeb....m4a",
    "status": "completed",
    "speaker_count": 4,
    "word_count": 2847,
    "language": "en",
    "tags": ["standup", "engineering"],
    "is_favorite": false,
    "created_at": "2026-01-15T10:30:00.000Z",
    "updated_at": "2026-01-15T10:35:00.000Z",
    "processed_at": "2026-01-15T10:35:00.000Z"
  },
  "transcript": { ... },
  "summary": { ... },
  "audio_url": "https://xyz.supabase.co/storage/v1/object/sign/recordings-audio/...?token=...",
  "audio_url_expires_at": "2026-01-15T11:30:00.000Z"
}
```

**Errors:**
- `404` - Recording not found

---

#### PATCH /recordings/:id
Update recording metadata.

**Request:**
```json
{
  "title": "Updated Title",
  "tags": ["meeting", "q1-planning"],
  "is_favorite": true
}
```

**Response (200 OK):**
```json
{
  "recording": { ... }
}
```

---

#### DELETE /recordings/:id
Delete a recording and all associated data.

**Response (204 No Content)**

**Errors:**
- `404` - Recording not found

---

#### POST /recordings/:id/reprocess
Reprocess a recording (re-run transcription and/or summarization).

**Request:**
```json
{
  "steps": ["transcribe", "summarize"]
}
```

**Response (200 OK):**
```json
{
  "recording": {
    "id": "987fcdeb-51a2-34bc-def0-123456789abc",
    "status": "transcribing"
  },
  "job": {
    "id": "job-789",
    "status": "queued"
  }
}
```

---

### 1.3 Transcript Endpoints

#### GET /recordings/:id/transcript
Get the full transcript for a recording.

**Response (200 OK):**
```json
{
  "transcript": {
    "id": "trans-123",
    "recording_id": "987fcdeb-51a2-34bc-def0-123456789abc",
    "full_text": "Good morning everyone. Let's get started with...",
    "segments": [
      {
        "id": "seg-001",
        "speaker_label": "Speaker 1",
        "speaker_index": 0,
        "text": "Good morning everyone. Let's get started with the standup.",
        "start_time": 0.0,
        "end_time": 3.5,
        "confidence": 0.98,
        "words": [
          { "word": "Good", "start_time": 0.0, "end_time": 0.3, "confidence": 0.99 },
          { "word": "morning", "start_time": 0.35, "end_time": 0.7, "confidence": 0.99 },
          ...
        ]
      },
      {
        "id": "seg-002",
        "speaker_label": "Speaker 2",
        "speaker_index": 1,
        "text": "Sure. Yesterday I worked on the authentication flow.",
        "start_time": 3.8,
        "end_time": 7.2,
        "confidence": 0.96
      }
    ],
    "word_count": 2847,
    "speaker_count": 4,
    "language": "en",
    "transcription_provider": "deepgram",
    "transcription_model": "nova-2",
    "created_at": "2026-01-15T10:32:00.000Z"
  }
}
```

**Errors:**
- `404` - Recording or transcript not found

---

#### GET /recordings/:id/transcript/search
Search within a recording's transcript.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Search query (required) |
| `limit` | integer | Max results (default 20) |

**Response (200 OK):**
```json
{
  "results": [
    {
      "segment_id": "seg-042",
      "text": "...working on the authentication flow and ran into some issues...",
      "start_time": 145.2,
      "end_time": 150.8,
      "speaker_label": "Speaker 2",
      "match_ranges": [
        { "start": 15, "end": 29 }
      ]
    }
  ],
  "total_matches": 3
}
```

---

### 1.4 Summary Endpoints

#### GET /recordings/:id/summary
Get the AI-generated summary for a recording.

**Response (200 OK):**
```json
{
  "summary": {
    "id": "sum-456",
    "recording_id": "987fcdeb-51a2-34bc-def0-123456789abc",
    "summary": "The team discussed sprint progress with a focus on the API refactor and mobile app blockers. Key decisions were made regarding the authentication architecture, and three action items were assigned for follow-up.",
    "key_points": [
      "API refactor is 80% complete, on track for Friday deadline",
      "Mobile team blocked on authentication endpoint",
      "Design review scheduled for Thursday",
      "Need to finalize database migration plan"
    ],
    "action_items": [
      {
        "text": "Complete authentication endpoint",
        "assignee": "John",
        "due_date": "Wednesday",
        "priority": "high"
      },
      {
        "text": "Share design mockups with team",
        "assignee": "Sarah",
        "due_date": null,
        "priority": "medium"
      },
      {
        "text": "Review API documentation",
        "assignee": null,
        "due_date": "end of week",
        "priority": "low"
      }
    ],
    "topics": ["sprint progress", "API refactor", "authentication", "mobile app"],
    "sentiment": {
      "overall": "positive",
      "score": 0.65
    },
    "llm_provider": "anthropic",
    "llm_model": "claude-3-5-sonnet-20241022",
    "created_at": "2026-01-15T10:34:00.000Z"
  }
}
```

**Errors:**
- `404` - Recording or summary not found

---

### 1.5 Q&A Endpoints

#### POST /recordings/:id/questions
Ask a question about a recording.

**Request:**
```json
{
  "question": "What were the main blockers discussed?",
  "include_context": true
}
```

**Response (200 OK):**
```json
{
  "answer": {
    "id": "qa-789",
    "recording_id": "987fcdeb-51a2-34bc-def0-123456789abc",
    "question": "What were the main blockers discussed?",
    "answer": "The main blocker discussed was the mobile team being blocked on the authentication endpoint. Speaker 2 mentioned they couldn't proceed with the login flow until the backend endpoint was ready. Additionally, there was a brief mention of waiting for design approval on the settings page.",
    "citations": [
      {
        "segment_id": "seg-042",
        "timestamp": 145.2,
        "text": "We're currently blocked on the auth endpoint",
        "relevance_score": 0.95
      },
      {
        "segment_id": "seg-067",
        "timestamp": 234.8,
        "text": "Still waiting for the design team to approve the settings mockups",
        "relevance_score": 0.72
      }
    ],
    "confidence": 0.89,
    "created_at": "2026-01-15T11:00:00.000Z"
  }
}
```

**Errors:**
- `404` - Recording not found
- `422` - Recording not yet transcribed

---

#### GET /recordings/:id/questions
Get Q&A history for a recording.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Max results |
| `offset` | integer | 0 | Pagination offset |

**Response (200 OK):**
```json
{
  "questions": [
    {
      "id": "qa-789",
      "question": "What were the main blockers discussed?",
      "answer": "The main blocker discussed was...",
      "citations": [...],
      "created_at": "2026-01-15T11:00:00.000Z"
    },
    {
      "id": "qa-788",
      "question": "Who is responsible for the API work?",
      "answer": "Based on the discussion...",
      "citations": [...],
      "created_at": "2026-01-15T10:58:00.000Z"
    }
  ],
  "total_count": 5
}
```

---

### 1.6 Search Endpoints

#### GET /search
Search across all recordings.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | - | Search query (required, min 2 chars) |
| `limit` | integer | 20 | Max results (max 50) |
| `offset` | integer | 0 | Pagination offset |
| `status` | string | `completed` | Filter by recording status |

**Response (200 OK):**
```json
{
  "results": [
    {
      "id": "result-001",
      "recording_id": "987fcdeb-51a2-34bc-def0-123456789abc",
      "recording_title": "Team Standup Meeting",
      "recording_date": "2026-01-15T10:30:00.000Z",
      "duration_seconds": 1423,
      "match_type": "transcript",
      "matched_text": "...working on the <<authentication>> flow and ran into...",
      "context_before": "Yesterday I was ",
      "context_after": " some issues with the token refresh.",
      "timestamp": 145.2,
      "relevance_score": 0.92
    },
    {
      "id": "result-002",
      "recording_id": "abc12345-6789-0def-ghij-klmnopqrstuv",
      "recording_title": "Architecture Review",
      "recording_date": "2026-01-12T14:00:00.000Z",
      "duration_seconds": 3600,
      "match_type": "summary",
      "matched_text": "Discussion focused on <<authentication>> architecture...",
      "timestamp": null,
      "relevance_score": 0.85
    }
  ],
  "meta": {
    "query": "authentication",
    "total_count": 15,
    "has_more": true
  }
}
```

---

### 1.7 Export Endpoints

#### POST /recordings/:id/export
Generate an export file for a recording.

**Request:**
```json
{
  "format": "pdf",
  "include_summary": true,
  "include_key_points": true,
  "include_action_items": true,
  "include_transcript": false,
  "include_timestamps": true
}
```

**Response (202 Accepted):**
```json
{
  "export": {
    "id": "exp-123",
    "recording_id": "987fcdeb-51a2-34bc-def0-123456789abc",
    "format": "pdf",
    "status": "generating"
  }
}
```

---

#### GET /recordings/:id/export/:exportId
Get export status and download URL.

**Response (200 OK):**
```json
{
  "export": {
    "id": "exp-123",
    "recording_id": "987fcdeb-51a2-34bc-def0-123456789abc",
    "format": "pdf",
    "status": "completed",
    "download_url": "https://xyz.supabase.co/storage/v1/object/sign/exports/...",
    "expires_at": "2026-01-15T12:00:00.000Z",
    "file_size_bytes": 45678,
    "file_name": "Team Standup Meeting - Summary.pdf"
  }
}
```

---

### 1.8 Webhook Endpoints (Internal)

#### POST /webhooks/processing
Internal webhook for processing pipeline status updates.

**Request (from Cloud Tasks):**
```json
{
  "job_id": "job-456",
  "recording_id": "987fcdeb-51a2-34bc-def0-123456789abc",
  "step": "transcription",
  "status": "completed",
  "result": {
    "word_count": 2847,
    "speaker_count": 4,
    "duration_ms": 45000
  }
}
```

**Response (200 OK):**
```json
{
  "acknowledged": true,
  "next_step": "summarization"
}
```

---

## 2. Authentication Flow

### 2.1 Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  iOS App                    Backend API                   Supabase Auth     │
│  ───────                    ───────────                   ─────────────     │
│     │                           │                              │            │
│     │  1. Login Request         │                              │            │
│     │  POST /auth/login ────────►                              │            │
│     │  {email, password}        │                              │            │
│     │                           │  2. Verify credentials       │            │
│     │                           │  ──────────────────────────► │            │
│     │                           │                              │            │
│     │                           │  3. JWT + Refresh Token      │            │
│     │                           │  ◄────────────────────────── │            │
│     │                           │                              │            │
│     │  4. Response              │                              │            │
│     │  {user, session} ◄────────│                              │            │
│     │                           │                              │            │
│     │  5. Store tokens          │                              │            │
│     │  (Keychain)               │                              │            │
│     │                           │                              │            │
│     │  6. API Request           │                              │            │
│     │  Authorization: Bearer ───►                              │            │
│     │                           │  7. Verify JWT               │            │
│     │                           │  (locally or via Supabase)   │            │
│     │                           │                              │            │
│     │  8. Response ◄────────────│                              │            │
│     │                           │                              │            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 JWT Verification

```typescript
// Middleware: verifyAuth.ts

import { createClient } from '@supabase/supabase-js';
import { Request, Response, NextFunction } from 'express';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
      };
    }
  }
}

export async function verifyAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid authorization header'
      }
    });
  }

  const token = authHeader.substring(7);

  try {
    // Option 1: Use Supabase to verify (recommended)
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` }
        }
      }
    );

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token'
        }
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email!,
      role: user.role || 'user'
    };

    next();
  } catch (err) {
    return res.status(401).json({
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed'
      }
    });
  }
}
```

### 2.3 Token Refresh Strategy

- **Access Token**: 1 hour expiry (Supabase default)
- **Refresh Token**: 30 days expiry
- **iOS Client**: Intercepts 401 responses, attempts refresh, retries request
- **Backend**: Stateless, validates tokens on each request

---

## 3. Asynchronous Processing Pipeline

### 3.1 Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
��                      PROCESSING PIPELINE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STATUS FLOW:                                                               │
│  ┌──────────┐    ┌──────────┐    ┌─────────────┐    ┌────────────┐         │
│  │uploading │───►│ uploaded │───►│transcribing │───►│transcribed │         │
│  └──────────┘    └──────────┘    └─────────────┘    └─────┬──────┘         │
│       │                                                    │                │
│       │                                                    ▼                │
│       │                                            ┌─────────────┐          │
│       │                                            │ summarizing │          │
│       │                                            └──────┬──────┘          │
│       │                                                   │                 │
│       ▼                                                   ▼                 │
│  ┌──────────┐                                      ┌───────────┐           │
│  │  failed  │◄─────────────────────────────────────│ completed │           │
│  └──────────┘                                      └───────────┘           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Implementation: Cloud Tasks + Cloud Run Workers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CLOUD ARCHITECTURE                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                         ┌─────────────────────┐                             │
│                         │   Cloud Run: API    │                             │
│                         │   (main service)    │                             │
│                         └──────────┬──────────┘                             │
│                                    │                                        │
│                    POST /recordings/:id/upload-complete                     │
│                                    │                                        │
│                                    ▼                                        │
│                         ┌─────────────────────┐                             │
│                         │   Cloud Tasks       │                             │
│                         │   Queue: process    │                             │
│                         └──────────┬──────────┘                             │
│                                    │                                        │
│              ┌─────────────────────┼─────────────────────┐                  │
│              │                     │                     │                  │
│              ▼                     ▼                     ▼                  │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐          │
│   │  Cloud Run:     │   │  Cloud Run:     │   │  Cloud Run:     │          │
│   │  Transcription  │   │  Summarization  │   │  Export         │          │
│   │  Worker         │   │  Worker         │   │  Worker         │          │
│   └────────┬────────┘   └────────┬────────┘   └────────┬────────┘          │
│            │                     │                     │                    │
│            ▼                     ▼                     ▼                    │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐          │
│   │   Deepgram      │   │   Claude API    │   │   PDF Generator │          │
│   │   API           │   │   (Anthropic)   │   │   (Puppeteer)   │          │
│   └─────────────────┘   └─────────────────┘   └─────────────────┘          │
│                                                                             │
│   All workers update Supabase Postgres and trigger next step               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Task Definitions

#### Transcription Task

```typescript
// tasks/transcription.ts

interface TranscriptionTask {
  type: 'transcription';
  recording_id: string;
  user_id: string;
  audio_path: string;
  language?: string;
  retry_count: number;
}

// Cloud Task payload
{
  "type": "transcription",
  "recording_id": "987fcdeb-51a2-34bc-def0-123456789abc",
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "audio_path": "123e4567.../987fcdeb....m4a",
  "language": "en",
  "retry_count": 0
}

// Task scheduling
const task = {
  httpRequest: {
    httpMethod: 'POST',
    url: `${WORKER_URL}/process/transcription`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ACCOUNT_TOKEN}`
    },
    body: Buffer.from(JSON.stringify(payload)).toString('base64')
  },
  scheduleTime: {
    seconds: Date.now() / 1000 + 5  // 5 second delay
  }
};

await cloudTasksClient.createTask({ parent: queuePath, task });
```

#### Summarization Task

```typescript
// tasks/summarization.ts

interface SummarizationTask {
  type: 'summarization';
  recording_id: string;
  user_id: string;
  transcript_id: string;
  retry_count: number;
}

// Enqueued after transcription completes
{
  "type": "summarization",
  "recording_id": "987fcdeb-51a2-34bc-def0-123456789abc",
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "transcript_id": "trans-123",
  "retry_count": 0
}
```

### 3.4 Worker Implementation

```typescript
// workers/transcription-worker.ts

import express from 'express';
import { createClient } from '@deepgram/sdk';
import { supabaseAdmin } from '../lib/supabase';

const app = express();
app.use(express.json());

app.post('/process/transcription', async (req, res) => {
  const { recording_id, user_id, audio_path, retry_count } = req.body;

  try {
    // 1. Update status to transcribing
    await supabaseAdmin
      .from('recordings')
      .update({ status: 'transcribing', updated_at: new Date().toISOString() })
      .eq('id', recording_id);

    // 2. Get signed URL for audio file
    const { data: signedUrl } = await supabaseAdmin.storage
      .from('recordings-audio')
      .createSignedUrl(audio_path, 3600);

    // 3. Send to Deepgram
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);
    const { result } = await deepgram.listen.prerecorded.transcribeUrl(
      { url: signedUrl.signedUrl },
      {
        model: 'nova-2',
        smart_format: true,
        diarize: true,
        punctuate: true,
        paragraphs: true,
        utterances: true
      }
    );

    // 4. Transform to our format
    const segments = transformDeepgramResult(result);
    const fullText = segments.map(s => s.text).join(' ');

    // 5. Store transcript
    await supabaseAdmin.from('transcripts').insert({
      recording_id,
      full_text: fullText,
      segments: JSON.stringify(segments),
      word_count: result.results.channels[0].alternatives[0].words.length,
      speaker_count: countUniqueSpeakers(segments),
      language: result.results.channels[0].detected_language || 'en',
      transcription_provider: 'deepgram',
      transcription_model: 'nova-2'
    });

    // 6. Update recording status
    await supabaseAdmin
      .from('recordings')
      .update({
        status: 'transcribed',
        speaker_count: countUniqueSpeakers(segments),
        word_count: result.results.channels[0].alternatives[0].words.length,
        updated_at: new Date().toISOString()
      })
      .eq('id', recording_id);

    // 7. Enqueue summarization task
    await enqueueSummarizationTask(recording_id, user_id);

    res.status(200).json({ success: true });

  } catch (error) {
    console.error('Transcription failed:', error);

    // Retry logic
    if (retry_count < 3) {
      await enqueueTranscriptionTask({
        recording_id,
        user_id,
        audio_path,
        retry_count: retry_count + 1
      }, Math.pow(2, retry_count) * 60); // Exponential backoff

      res.status(200).json({ retrying: true });
    } else {
      // Mark as failed after max retries
      await supabaseAdmin
        .from('recordings')
        .update({
          status: 'failed',
          error_message: error.message,
          error_code: 'TRANSCRIPTION_FAILED',
          updated_at: new Date().toISOString()
        })
        .eq('id', recording_id);

      res.status(200).json({ failed: true });
    }
  }
});

function transformDeepgramResult(result: any): TranscriptSegment[] {
  const utterances = result.results.utterances || [];

  return utterances.map((u: any, index: number) => ({
    id: `seg-${index.toString().padStart(3, '0')}`,
    speaker_label: `Speaker ${u.speaker + 1}`,
    speaker_index: u.speaker,
    text: u.transcript,
    start_time: u.start,
    end_time: u.end,
    confidence: u.confidence,
    words: u.words?.map((w: any) => ({
      word: w.punctuated_word || w.word,
      start_time: w.start,
      end_time: w.end,
      confidence: w.confidence
    }))
  }));
}
```

### 3.5 Job Status Tracking

Jobs are tracked directly in the `recordings` table via the `status` column:

```sql
-- Query to check processing status
SELECT
  id,
  title,
  status,
  error_message,
  created_at,
  updated_at,
  EXTRACT(EPOCH FROM (updated_at - created_at)) as processing_seconds
FROM recordings
WHERE user_id = $1
  AND status IN ('uploading', 'uploaded', 'transcribing', 'transcribed', 'summarizing')
ORDER BY created_at DESC;
```

For more detailed job tracking (optional):

```sql
-- Optional: jobs table for detailed tracking
CREATE TABLE processing_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,  -- 'transcription', 'summarization', 'export'
  status TEXT NOT NULL DEFAULT 'queued',  -- queued, running, completed, failed
  attempt_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.6 Error Handling & Retries

```typescript
// Retry configuration
const RETRY_CONFIG = {
  transcription: {
    maxRetries: 3,
    backoffMultiplier: 2,
    initialDelaySeconds: 60
  },
  summarization: {
    maxRetries: 3,
    backoffMultiplier: 2,
    initialDelaySeconds: 30
  },
  export: {
    maxRetries: 2,
    backoffMultiplier: 1.5,
    initialDelaySeconds: 10
  }
};

// Backoff calculation
function getRetryDelay(attemptCount: number, config: RetryConfig): number {
  return config.initialDelaySeconds * Math.pow(config.backoffMultiplier, attemptCount);
}
```

---

## 4. Environment Variables & Configuration

### 4.1 Environment Variables

```bash
# ============================================================================
# SUMMARY AI - ENVIRONMENT VARIABLES
# ============================================================================

# ----- Application -----
NODE_ENV=production
PORT=8080
API_VERSION=v1
LOG_LEVEL=info

# ----- Supabase -----
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_ANON_KEY=eyJhbG...                    # Public anon key (for client auth)
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...            # Service role key (for admin operations)
SUPABASE_JWT_SECRET=your-jwt-secret            # For local JWT verification (optional)

# ----- Deepgram (Speech-to-Text) -----
DEEPGRAM_API_KEY=your-deepgram-api-key
DEEPGRAM_MODEL=nova-2                          # Model to use

# ----- Anthropic (LLM) -----
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022     # Default model
ANTHROPIC_MAX_TOKENS=4096                      # Max tokens for summarization

# ----- Google Cloud -----
GCP_PROJECT_ID=summary-ai-prod
GCP_REGION=us-central1
CLOUD_TASKS_QUEUE=processing-queue
CLOUD_TASKS_LOCATION=us-central1

# ----- Service URLs (for internal communication) -----
TRANSCRIPTION_WORKER_URL=https://transcription-worker-xyz.run.app
SUMMARIZATION_WORKER_URL=https://summarization-worker-xyz.run.app
EXPORT_WORKER_URL=https://export-worker-xyz.run.app

# ----- Rate Limiting -----
RATE_LIMIT_WINDOW_MS=60000                     # 1 minute
RATE_LIMIT_MAX_REQUESTS=100                    # Per window

# ----- File Limits -----
MAX_AUDIO_FILE_SIZE_MB=200
MAX_RECORDING_DURATION_SECONDS=14400           # 4 hours

# ----- Push Notifications (APNs) -----
APNS_KEY_ID=your-key-id
APNS_TEAM_ID=your-team-id
APNS_BUNDLE_ID=com.summaryai.app
APNS_KEY_PATH=/secrets/apns-key.p8            # Mounted secret
```

### 4.2 Cloud Run Configuration

```yaml
# cloud-run-api.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: summary-ai-api
  annotations:
    run.googleapis.com/ingress: all
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "10"
        run.googleapis.com/cpu-throttling: "false"
    spec:
      containerConcurrency: 80
      timeoutSeconds: 300
      containers:
        - image: gcr.io/summary-ai-prod/api:latest
          ports:
            - containerPort: 8080
          resources:
            limits:
              cpu: "2"
              memory: "1Gi"
          env:
            - name: NODE_ENV
              value: "production"
            - name: SUPABASE_URL
              valueFrom:
                secretKeyRef:
                  name: supabase-config
                  key: url
            - name: SUPABASE_SERVICE_ROLE_KEY
              valueFrom:
                secretKeyRef:
                  name: supabase-config
                  key: service-role-key
            - name: DEEPGRAM_API_KEY
              valueFrom:
                secretKeyRef:
                  name: deepgram-config
                  key: api-key
            - name: ANTHROPIC_API_KEY
              valueFrom:
                secretKeyRef:
                  name: anthropic-config
                  key: api-key
```

```yaml
# cloud-run-worker.yaml (transcription worker)
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: transcription-worker
  annotations:
    run.googleapis.com/ingress: internal  # Only internal traffic
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "0"
        autoscaling.knative.dev/maxScale: "5"
    spec:
      containerConcurrency: 1  # One transcription at a time per instance
      timeoutSeconds: 900      # 15 minutes for long recordings
      containers:
        - image: gcr.io/summary-ai-prod/transcription-worker:latest
          resources:
            limits:
              cpu: "2"
              memory: "2Gi"
          # ... env vars ...
```

### 4.3 Secret Management

```bash
# Create secrets in Google Cloud Secret Manager
gcloud secrets create supabase-config --replication-policy="automatic"
gcloud secrets versions add supabase-config --data-file=./secrets/supabase.json

gcloud secrets create deepgram-config --replication-policy="automatic"
gcloud secrets versions add deepgram-config --data-file=./secrets/deepgram.json

gcloud secrets create anthropic-config --replication-policy="automatic"
gcloud secrets versions add anthropic-config --data-file=./secrets/anthropic.json

# Grant Cloud Run access to secrets
gcloud secrets add-iam-policy-binding supabase-config \
  --member="serviceAccount:summary-ai-prod@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 4.4 Configuration Loading

```typescript
// config/index.ts

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default('8080'),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Deepgram
  DEEPGRAM_API_KEY: z.string().min(1),
  DEEPGRAM_MODEL: z.string().default('nova-2'),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-sonnet-20241022'),
  ANTHROPIC_MAX_TOKENS: z.string().transform(Number).default('4096'),

  // GCP
  GCP_PROJECT_ID: z.string().min(1),
  GCP_REGION: z.string().default('us-central1'),
  CLOUD_TASKS_QUEUE: z.string().default('processing-queue'),

  // Limits
  MAX_AUDIO_FILE_SIZE_MB: z.string().transform(Number).default('200'),
  MAX_RECORDING_DURATION_SECONDS: z.string().transform(Number).default('14400'),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
```

---

## 5. Error Response Format

All error responses follow a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Additional context if applicable"
    }
  }
}
```

### Standard Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `BAD_REQUEST` | Invalid request body or parameters |
| 400 | `VALIDATION_ERROR` | Request validation failed |
| 401 | `UNAUTHORIZED` | Missing or invalid auth token |
| 401 | `TOKEN_EXPIRED` | Access token has expired |
| 403 | `FORBIDDEN` | User doesn't have permission |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Resource state conflict |
| 413 | `PAYLOAD_TOO_LARGE` | File exceeds size limit |
| 422 | `UNPROCESSABLE_ENTITY` | Request understood but cannot be processed |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `SERVICE_UNAVAILABLE` | Temporary service issue |

---

## 6. Rate Limiting

```typescript
// Limits per endpoint category
const rateLimits = {
  auth: {
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 10                     // 10 requests per window
  },
  upload: {
    windowMs: 60 * 60 * 1000,  // 1 hour
    max: 20                     // 20 uploads per hour
  },
  questions: {
    windowMs: 60 * 1000,       // 1 minute
    max: 10                     // 10 questions per minute
  },
  search: {
    windowMs: 60 * 1000,       // 1 minute
    max: 30                     // 30 searches per minute
  },
  default: {
    windowMs: 60 * 1000,       // 1 minute
    max: 100                    // 100 requests per minute
  }
};
```

---

## 7. API Versioning Strategy

- Version prefix in URL: `/v1/`, `/v2/`
- Breaking changes require new major version
- Old versions supported for 6 months after deprecation notice
- Version specified in response headers: `X-API-Version: v1`

---

*Document version: 1.0*
*Last updated: January 2026*
