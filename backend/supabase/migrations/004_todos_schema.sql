-- Migration: Add todos table for voice-created todo lists
-- Created: 2025-01-02

-- Create todos table
CREATE TABLE IF NOT EXISTS todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    recording_id UUID REFERENCES recordings(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    priority TEXT CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
    due_date TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for user lookups
CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);

-- Create index for recording lookups
CREATE INDEX IF NOT EXISTS idx_todos_recording_id ON todos(recording_id);

-- Create index for incomplete todos (most common query)
CREATE INDEX IF NOT EXISTS idx_todos_user_incomplete ON todos(user_id) WHERE is_completed = FALSE;

-- Enable RLS
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can only access their own todos
CREATE POLICY "Users can manage their own todos"
    ON todos
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_todos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER todos_updated_at
    BEFORE UPDATE ON todos
    FOR EACH ROW
    EXECUTE FUNCTION update_todos_updated_at();
