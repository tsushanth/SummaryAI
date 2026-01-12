-- Migration: 006_live_transcripts.sql
-- Add live transcript streaming and AI insights tables

-- Store live transcript segments streamed from Recall.ai during meetings
CREATE TABLE IF NOT EXISTS live_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    bot_run_id UUID NOT NULL REFERENCES bot_runs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Transcript data from Recall webhook
    segment_text TEXT NOT NULL,
    speaker_id TEXT,  -- Recall participant ID
    speaker_name TEXT,
    is_host BOOLEAN DEFAULT false,

    -- Timing (seconds from meeting start)
    start_timestamp DOUBLE PRECISION NOT NULL,
    end_timestamp DOUBLE PRECISION NOT NULL,

    -- Word-level data (JSONB array of {text, start_timestamp, end_timestamp})
    words JSONB,

    -- Flags
    is_partial BOOLEAN DEFAULT false,  -- true for transcript.partial_data events

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_live_transcripts_meeting ON live_transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_live_transcripts_bot_run ON live_transcripts(bot_run_id);
CREATE INDEX IF NOT EXISTS idx_live_transcripts_created ON live_transcripts(created_at);
CREATE INDEX IF NOT EXISTS idx_live_transcripts_user ON live_transcripts(user_id);

-- Store AI insights generated during live meetings
CREATE TABLE IF NOT EXISTS live_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Insight content
    insight_type TEXT NOT NULL CHECK (insight_type IN ('fact_check', 'key_point', 'question', 'contradiction')),
    content TEXT NOT NULL,
    context TEXT,  -- Related transcript text that triggered this insight

    -- For cross-meeting references
    related_meeting_id UUID REFERENCES meetings(id),
    related_recording_id UUID REFERENCES recordings(id),

    -- Metadata
    confidence DOUBLE PRECISION,  -- 0.0 to 1.0
    verification_status TEXT CHECK (verification_status IN ('verified', 'disputed', 'false', 'unknown')),

    -- Timing (seconds into meeting when this occurred)
    timestamp_seconds DOUBLE PRECISION,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_live_insights_meeting ON live_insights(meeting_id);
CREATE INDEX IF NOT EXISTS idx_live_insights_type ON live_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_live_insights_user ON live_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_live_insights_created ON live_insights(created_at);

-- Enable RLS
ALTER TABLE live_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_insights ENABLE ROW LEVEL SECURITY;

-- RLS Policies for live_transcripts
CREATE POLICY "Users can view their own live transcripts"
    ON live_transcripts FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert live transcripts"
    ON live_transcripts FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Service role can delete live transcripts"
    ON live_transcripts FOR DELETE
    USING (true);

-- RLS Policies for live_insights
CREATE POLICY "Users can view their own live insights"
    ON live_insights FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert live insights"
    ON live_insights FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Service role can update live insights"
    ON live_insights FOR UPDATE
    USING (true);

CREATE POLICY "Service role can delete live insights"
    ON live_insights FOR DELETE
    USING (true);
