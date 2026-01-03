-- Summary AI Database Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/mlofjzlmncgnhxbiuemf/sql)

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy text search

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PROFILES TABLE
-- ============================================================================
-- Extends Supabase Auth with additional user data

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    preferences JSONB DEFAULT '{
        "audio_quality": "standard",
        "auto_title_with_ai": true,
        "default_playback_speed": 1.0
    }'::jsonb,
    recording_consent_acknowledged_at TIMESTAMPTZ,
    terms_accepted_at TIMESTAMPTZ,
    privacy_policy_accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- RECORDING STATUS TYPE
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE recording_status AS ENUM (
        'uploading',
        'uploaded',
        'transcribing',
        'transcribed',
        'summarizing',
        'completed',
        'failed'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- RECORDINGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS recordings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    duration_seconds INTEGER,
    file_size_bytes BIGINT,
    file_path TEXT NOT NULL,
    status recording_status NOT NULL DEFAULT 'uploading',
    error_message TEXT,
    error_code TEXT,
    speaker_count INTEGER,
    word_count INTEGER,
    language TEXT DEFAULT 'en',
    tags TEXT[] DEFAULT '{}',
    is_favorite BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT valid_duration CHECK (duration_seconds IS NULL OR duration_seconds > 0),
    CONSTRAINT valid_file_size CHECK (file_size_bytes IS NULL OR file_size_bytes > 0)
);

CREATE INDEX IF NOT EXISTS idx_recordings_user_id ON recordings(user_id);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_user_created ON recordings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_tags ON recordings USING GIN(tags);

DROP TRIGGER IF EXISTS update_recordings_updated_at ON recordings;
CREATE TRIGGER update_recordings_updated_at
    BEFORE UPDATE ON recordings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TRANSCRIPTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS transcripts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    full_text TEXT NOT NULL,
    segments JSONB NOT NULL DEFAULT '[]'::jsonb,
    word_count INTEGER NOT NULL DEFAULT 0,
    speaker_count INTEGER NOT NULL DEFAULT 0,
    language TEXT NOT NULL DEFAULT 'en',
    transcription_provider TEXT,
    transcription_model TEXT,
    processing_duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_recording_transcript UNIQUE(recording_id)
);

CREATE INDEX IF NOT EXISTS idx_transcripts_fulltext ON transcripts
    USING GIN(to_tsvector('english', full_text));
CREATE INDEX IF NOT EXISTS idx_transcripts_trgm ON transcripts
    USING GIN(full_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_transcripts_recording_id ON transcripts(recording_id);

-- ============================================================================
-- SUMMARIES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    topics JSONB NOT NULL DEFAULT '[]'::jsonb,
    sentiment JSONB,
    llm_provider TEXT,
    llm_model TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    processing_duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_recording_summary UNIQUE(recording_id)
);

CREATE INDEX IF NOT EXISTS idx_summaries_recording_id ON summaries(recording_id);
CREATE INDEX IF NOT EXISTS idx_summaries_fulltext ON summaries
    USING GIN(to_tsvector('english', summary));

-- ============================================================================
-- QA_HISTORY TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    citations JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence DOUBLE PRECISION,
    llm_provider TEXT,
    llm_model TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    processing_duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_history_recording_id ON qa_history(recording_id);
CREATE INDEX IF NOT EXISTS idx_qa_history_user_id ON qa_history(user_id);
CREATE INDEX IF NOT EXISTS idx_qa_history_created_at ON qa_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_history_recording_created ON qa_history(recording_id, created_at ASC);

-- ============================================================================
-- TAGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_tag UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);

CREATE TABLE IF NOT EXISTS recording_tags (
    recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (recording_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_recording_tags_tag_id ON recording_tags(tag_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_tags ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can only access their own profile
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Recordings: Users can only access their own recordings
DROP POLICY IF EXISTS recordings_select ON recordings;
CREATE POLICY recordings_select ON recordings
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS recordings_insert ON recordings;
CREATE POLICY recordings_insert ON recordings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS recordings_update ON recordings;
CREATE POLICY recordings_update ON recordings
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS recordings_delete ON recordings;
CREATE POLICY recordings_delete ON recordings
    FOR DELETE USING (auth.uid() = user_id);

-- Transcripts: Access via recording ownership
DROP POLICY IF EXISTS transcripts_select ON transcripts;
CREATE POLICY transcripts_select ON transcripts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM recordings
            WHERE recordings.id = transcripts.recording_id
            AND recordings.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS transcripts_insert ON transcripts;
CREATE POLICY transcripts_insert ON transcripts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM recordings
            WHERE recordings.id = transcripts.recording_id
            AND recordings.user_id = auth.uid()
        )
    );

-- Summaries: Access via recording ownership
DROP POLICY IF EXISTS summaries_select ON summaries;
CREATE POLICY summaries_select ON summaries
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM recordings
            WHERE recordings.id = summaries.recording_id
            AND recordings.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS summaries_insert ON summaries;
CREATE POLICY summaries_insert ON summaries
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM recordings
            WHERE recordings.id = summaries.recording_id
            AND recordings.user_id = auth.uid()
        )
    );

-- QA History: Users can only access their own Q&A
DROP POLICY IF EXISTS qa_history_select ON qa_history;
CREATE POLICY qa_history_select ON qa_history
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS qa_history_insert ON qa_history;
CREATE POLICY qa_history_insert ON qa_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Tags: Users can only access their own tags
DROP POLICY IF EXISTS tags_select ON tags;
CREATE POLICY tags_select ON tags
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS tags_insert ON tags;
CREATE POLICY tags_insert ON tags
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS tags_update ON tags;
CREATE POLICY tags_update ON tags
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS tags_delete ON tags;
CREATE POLICY tags_delete ON tags
    FOR DELETE USING (auth.uid() = user_id);

-- Recording Tags: Access via recording ownership
DROP POLICY IF EXISTS recording_tags_select ON recording_tags;
CREATE POLICY recording_tags_select ON recording_tags
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM recordings
            WHERE recordings.id = recording_tags.recording_id
            AND recordings.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS recording_tags_insert ON recording_tags;
CREATE POLICY recording_tags_insert ON recording_tags
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM recordings
            WHERE recordings.id = recording_tags.recording_id
            AND recordings.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS recording_tags_delete ON recording_tags;
CREATE POLICY recording_tags_delete ON recording_tags
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM recordings
            WHERE recordings.id = recording_tags.recording_id
            AND recordings.user_id = auth.uid()
        )
    );

-- ============================================================================
-- SERVICE ROLE POLICIES (for backend operations)
-- ============================================================================
-- The service role key bypasses RLS, but we add explicit policies for clarity

-- Allow service role to manage all recordings (for processing)
DROP POLICY IF EXISTS recordings_service_all ON recordings;
CREATE POLICY recordings_service_all ON recordings
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS transcripts_service_all ON transcripts;
CREATE POLICY transcripts_service_all ON transcripts
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS summaries_service_all ON summaries;
CREATE POLICY summaries_service_all ON summaries
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- STORAGE BUCKETS
-- ============================================================================
-- Run these in the Supabase Dashboard > Storage section, or use:

-- Create recordings-audio bucket (if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'recordings-audio',
    'recordings-audio',
    false,
    209715200,  -- 200MB
    ARRAY['audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/wav', 'audio/x-m4a']
)
ON CONFLICT (id) DO NOTHING;

-- Create exports bucket (if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
    'exports',
    'exports',
    false,
    52428800  -- 50MB
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for recordings-audio bucket
DROP POLICY IF EXISTS "Users can upload their own recordings" ON storage.objects;
CREATE POLICY "Users can upload their own recordings" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'recordings-audio' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can read their own recordings" ON storage.objects;
CREATE POLICY "Users can read their own recordings" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'recordings-audio' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can delete their own recordings" ON storage.objects;
CREATE POLICY "Users can delete their own recordings" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'recordings-audio' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

-- Service role can access all storage
DROP POLICY IF EXISTS "Service role can access all recordings" ON storage.objects;
CREATE POLICY "Service role can access all recordings" ON storage.objects
    FOR ALL USING (
        bucket_id = 'recordings-audio' AND
        auth.jwt() ->> 'role' = 'service_role'
    );

-- ============================================================================
-- CREATE PROFILE FOR EXISTING USERS (if any)
-- ============================================================================

INSERT INTO profiles (id, email)
SELECT id, email FROM auth.users
WHERE id NOT IN (SELECT id FROM profiles)
ON CONFLICT (id) DO NOTHING;

-- Done!
SELECT 'Database schema created successfully!' as status;
