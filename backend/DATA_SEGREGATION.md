# Data Segregation Policy

## Overview

Meeting Mind (formerly SummaryAI) implements complete data segregation between Google Calendar data and AI processing services to comply with Google OAuth verification requirements.

## Architecture

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER FLOW                                       │
└─────────────────────────────────────────────────────────────────────────┘

1. Calendar Sync Flow (Google Calendar API → Our Database)
   ┌──────────────────┐      ┌─────────────────────┐      ┌──────────────┐
   │  Google Calendar │ ──── │  Meeting Mind API   │ ──── │   Database   │
   │       API        │      │  (calendar.ts)      │      │  (Supabase)  │
   └──────────────────┘      └─────────────────────┘      └──────────────┘
                                      │
                                      ▼
                             Data Stored:
                             ✗ Event title (NOT stored)
                             ✗ Event description (NOT stored)
                             ✓ Join URL (for bot dispatch)
                             ✓ Start/end times (scheduling)
                             ✓ Timezone (display)
                             ✓ Event ID (sync tracking)

                             Generated:
                             ✓ Generic title: "Zoom Meeting - Jan 15"

2. Meeting Recording Flow (Meeting → AI Processing)
   ┌──────────────────┐      ┌─────────────────────┐      ┌──────────────┐
   │  Video Meeting   │ ──── │   Recall.ai Bot     │ ──── │ Audio/Video  │
   │ (Zoom/Teams/etc) │      │  (records meeting)  │      │   File       │
   └──────────────────┘      └─────────────────────┘      └──────────────┘
                                                                  │
                                                                  ▼
                                                    ┌─────────────────────┐
                                                    │   AI Processing     │
                                                    │ (Deepgram, OpenAI)  │
                                                    └─────────────────────┘
                                                                  │
                                                    Data Processed:
                                                    ✓ Meeting audio (from bot)
                                                    ✗ Google Calendar data (NEVER)
```

## Implementation Details

### What Google Calendar Data Is Used

| Data Field | Stored | Used For | Sent to AI |
|------------|--------|----------|------------|
| Event Title (summary) | ❌ NO | N/A | ❌ NO |
| Event Description | ❌ NO | N/A | ❌ NO |
| Attendee List | ❌ NO | N/A | ❌ NO |
| Join URL | ✅ YES | Bot dispatch | ❌ NO |
| Start/End Time | ✅ YES | Scheduling | ❌ NO |
| Timezone | ✅ YES | Time display | ❌ NO |
| Event ID | ✅ YES | Sync tracking | ❌ NO |
| Event ETag | ✅ YES | Change detection | ❌ NO |

### Generic Title Generation

Instead of storing Google Calendar event titles, we generate generic titles:

```typescript
// Example from calendar.ts
const meetingDate = new Date(scheduledStart);
const genericTitle = `${platform} Meeting - ${meetingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

// Results in titles like:
// "Zoom Meeting - Jan 15"
// "Google Meet Meeting - Feb 3"
// "Teams Meeting - Mar 22"
```

### AI Processing Pipeline

The AI services (Deepgram for transcription, OpenAI for summarization) ONLY receive:

1. **Audio/video content** - Captured by the Recall.ai bot during the actual meeting
2. **Transcript text** - Generated from audio by Deepgram
3. **Speaker segments** - Identified from audio by Deepgram

The AI services NEVER receive:
- Google Calendar event titles
- Google Calendar event descriptions
- Google Calendar attendee information
- Any metadata from Google Calendar API

### Code References

- **Calendar sync**: `backend/src/routes/calendar.ts`
  - Lines 919-966: Google Calendar sync with data segregation
  - Lines 1042-1089: Microsoft Calendar sync with data segregation

- **AI Processing**: `backend/src/services/processingService.ts`
  - Lines 372-445: Summary generation (only uses transcript)

## Verification

To verify data segregation:

1. **Database Check**: Query the `meetings` table for calendar-sourced meetings:
   ```sql
   SELECT title, description, source
   FROM meetings
   WHERE source = 'calendar';
   ```
   - All titles should be generic (e.g., "Zoom Meeting - Jan 15")
   - All descriptions should be NULL

2. **Log Check**: The AI processing logs only show transcript content being processed, never calendar metadata.

3. **Code Review**: Search for any usage of `event.summary`, `event.description`, or `event.subject` - all should be replaced with generic titles.

## Compliance Statement

Meeting Mind complies with Google OAuth verification requirements by:

1. **Not storing** Google Calendar event titles, descriptions, or attendee information
2. **Not sending** any Google Calendar data to third-party AI services
3. **Only using** join URLs from calendar events for the sole purpose of dispatching recording bots
4. **Generating** meeting audio/video content independently through the bot's recording of the actual meeting
5. **Processing** only user-generated content (meeting recordings) through AI services

The AI summarization feature processes content that users create during their meetings, not content obtained from Google APIs.
