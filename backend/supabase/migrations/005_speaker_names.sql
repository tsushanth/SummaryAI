-- Migration: Add speaker_names to transcripts for custom speaker labeling
-- Created: 2025-01-05

-- Add speaker_names column to transcripts table
-- Maps speaker_index (as string key) to custom name
-- Example: {"0": "John Smith", "1": "Sarah Johnson"}
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transcripts' AND column_name = 'speaker_names'
    ) THEN
        ALTER TABLE transcripts ADD COLUMN speaker_names JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- Create GIN index for efficient JSONB operations (if needed for queries)
CREATE INDEX IF NOT EXISTS idx_transcripts_speaker_names ON transcripts USING GIN(speaker_names);
