-- Migration to support pending recordings (created when bot is scheduled, before recording starts)
-- This allows recordings to appear in the list immediately when a meeting bot is scheduled

-- ============================================================================
-- ADD 'pending' TO recording_status ENUM
-- ============================================================================

-- PostgreSQL doesn't allow easy modification of enums, so we need to:
-- 1. Add the new value to the enum type

ALTER TYPE recording_status ADD VALUE IF NOT EXISTS 'pending' BEFORE 'uploading';

-- ============================================================================
-- MAKE file_path NULLABLE
-- ============================================================================
-- Pending recordings don't have a file yet, so file_path needs to be nullable

ALTER TABLE recordings ALTER COLUMN file_path DROP NOT NULL;

-- ============================================================================
-- ADD meeting_id COLUMN (to link pending recordings to meetings)
-- ============================================================================

-- Add meeting_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'recordings' AND column_name = 'meeting_id'
    ) THEN
        ALTER TABLE recordings ADD COLUMN meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_recordings_meeting_id ON recordings(meeting_id);
    END IF;
END $$;

-- Done!
SELECT 'Pending recordings support added successfully!' as status;
