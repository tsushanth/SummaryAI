-- ============================================================================
-- Add recording_type column to recordings table
-- Supports differentiating between audio recordings and imported PDFs
-- ============================================================================

-- Create recording_type enum
DO $$ BEGIN
    CREATE TYPE recording_type AS ENUM (
        'general',
        'meeting',
        'lecture',
        'interview',
        'voice_memo',
        'imported'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add recording_type column to recordings table
ALTER TABLE recordings
ADD COLUMN IF NOT EXISTS recording_type recording_type DEFAULT 'general';

-- Add content_type column to track file type (audio/mp4, application/pdf, etc.)
ALTER TABLE recordings
ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'audio/mp4';

-- Create index for filtering by recording_type
CREATE INDEX IF NOT EXISTS idx_recordings_type ON recordings(recording_type);

-- Update storage bucket to accept PDFs
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
    'audio/mp4',
    'audio/m4a',
    'audio/mpeg',
    'audio/wav',
    'audio/x-m4a',
    'application/pdf'
]
WHERE id = 'recordings-audio';
