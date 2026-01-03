-- ============================================================================
-- Meeting Bot Tables Migration
-- Calendar connections, meetings, bot runs, and scheduling
-- ============================================================================

-- ============================================================================
-- OAuth States (temporary storage for OAuth CSRF protection)
-- ============================================================================

CREATE TABLE IF NOT EXISTS oauth_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup and lookup
CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);

-- ============================================================================
-- Calendar Connections
-- ============================================================================

CREATE TABLE IF NOT EXISTS calendar_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ NOT NULL,
    provider_account_id TEXT,
    provider_email TEXT,
    sync_token TEXT,
    last_synced_at TIMESTAMPTZ,
    sync_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, provider)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calendar_connections_user_id ON calendar_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_connections_sync_enabled ON calendar_connections(sync_enabled) WHERE sync_enabled = true;

-- ============================================================================
-- Meetings
-- ============================================================================

CREATE TABLE IF NOT EXISTS meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('calendar', 'manual')) DEFAULT 'manual',
    calendar_connection_id UUID REFERENCES calendar_connections(id) ON DELETE SET NULL,
    calendar_event_id TEXT,
    calendar_event_etag TEXT,
    title TEXT NOT NULL,
    description TEXT,
    platform TEXT CHECK (platform IN (
        'zoom', 'google_meet', 'teams', 'webex', 'goto_meeting',
        'chime', 'bluejeans', 'ringcentral', 'lifesize', 'slack', 'unknown'
    )),
    join_url TEXT NOT NULL,
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end TIMESTAMPTZ,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    auto_join BOOLEAN NOT NULL DEFAULT false,
    join_offset_minutes INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN (
        'scheduled', 'bot_queued', 'bot_joining', 'bot_in_meeting',
        'bot_left', 'completed', 'cancelled', 'failed'
    )) DEFAULT 'scheduled',
    recording_id UUID REFERENCES recordings(id) ON DELETE SET NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_meetings_user_id ON meetings(user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_start ON meetings(scheduled_start);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_auto_join ON meetings(auto_join) WHERE auto_join = true;
CREATE INDEX IF NOT EXISTS idx_meetings_calendar_event ON meetings(user_id, calendar_event_id);

-- ============================================================================
-- Bot Runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS bot_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    recall_bot_id TEXT NOT NULL,
    recall_status TEXT,
    status TEXT NOT NULL CHECK (status IN (
        'pending', 'joining', 'in_call', 'recording',
        'processing', 'completed', 'failed', 'cancelled'
    )) DEFAULT 'pending',
    join_requested_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    recording_url TEXT,
    transcript_url TEXT,
    duration_seconds INTEGER,
    error_code TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bot_runs_meeting_id ON bot_runs(meeting_id);
CREATE INDEX IF NOT EXISTS idx_bot_runs_recall_bot_id ON bot_runs(recall_bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_runs_status ON bot_runs(status);

-- ============================================================================
-- Bot Scheduler Jobs
-- ============================================================================

CREATE TABLE IF NOT EXISTS bot_scheduler_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    cloud_task_name TEXT,
    scheduled_for TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'scheduled', 'executed', 'cancelled', 'failed'
    )) DEFAULT 'scheduled',
    executed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bot_scheduler_jobs_meeting_id ON bot_scheduler_jobs(meeting_id);
CREATE INDEX IF NOT EXISTS idx_bot_scheduler_jobs_status ON bot_scheduler_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bot_scheduler_jobs_scheduled_for ON bot_scheduler_jobs(scheduled_for);

-- ============================================================================
-- Sharing Preferences
-- ============================================================================

CREATE TABLE IF NOT EXISTS sharing_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    send_to_myself BOOLEAN NOT NULL DEFAULT true,
    send_to_team BOOLEAN NOT NULL DEFAULT false,
    send_to_everyone BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

-- Enable RLS
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_scheduler_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sharing_preferences ENABLE ROW LEVEL SECURITY;

-- OAuth States: Users can only see their own
CREATE POLICY "Users can view own oauth states"
    ON oauth_states FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own oauth states"
    ON oauth_states FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own oauth states"
    ON oauth_states FOR DELETE
    USING (auth.uid() = user_id);

-- Calendar Connections: Users can only manage their own
CREATE POLICY "Users can view own calendar connections"
    ON calendar_connections FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own calendar connections"
    ON calendar_connections FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own calendar connections"
    ON calendar_connections FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own calendar connections"
    ON calendar_connections FOR DELETE
    USING (auth.uid() = user_id);

-- Meetings: Users can only manage their own
CREATE POLICY "Users can view own meetings"
    ON meetings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own meetings"
    ON meetings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own meetings"
    ON meetings FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own meetings"
    ON meetings FOR DELETE
    USING (auth.uid() = user_id);

-- Bot Runs: Users can only view their own
CREATE POLICY "Users can view own bot runs"
    ON bot_runs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bot runs"
    ON bot_runs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bot runs"
    ON bot_runs FOR UPDATE
    USING (auth.uid() = user_id);

-- Bot Scheduler Jobs: Accessible via meeting ownership
CREATE POLICY "Users can view scheduler jobs for own meetings"
    ON bot_scheduler_jobs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM meetings
            WHERE meetings.id = bot_scheduler_jobs.meeting_id
            AND meetings.user_id = auth.uid()
        )
    );

-- Sharing Preferences: Users can only manage their own
CREATE POLICY "Users can view own sharing preferences"
    ON sharing_preferences FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sharing preferences"
    ON sharing_preferences FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sharing preferences"
    ON sharing_preferences FOR UPDATE
    USING (auth.uid() = user_id);

-- ============================================================================
-- Service Role Policies (for backend operations)
-- ============================================================================

-- Service role can manage all meeting-related tables
CREATE POLICY "Service role has full access to oauth_states"
    ON oauth_states FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role has full access to calendar_connections"
    ON calendar_connections FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role has full access to meetings"
    ON meetings FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role has full access to bot_runs"
    ON bot_runs FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role has full access to bot_scheduler_jobs"
    ON bot_scheduler_jobs FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role has full access to sharing_preferences"
    ON sharing_preferences FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers
CREATE TRIGGER update_calendar_connections_updated_at
    BEFORE UPDATE ON calendar_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_meetings_updated_at
    BEFORE UPDATE ON meetings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bot_runs_updated_at
    BEFORE UPDATE ON bot_runs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sharing_preferences_updated_at
    BEFORE UPDATE ON sharing_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Add source column to recordings if not exists
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'recordings' AND column_name = 'source'
    ) THEN
        ALTER TABLE recordings ADD COLUMN source TEXT DEFAULT 'upload';
    END IF;
END $$;
