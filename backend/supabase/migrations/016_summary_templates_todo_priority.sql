-- Summary templates + todo priority 'none'.
-- (015 is reserved for slice D: 015_integrations.sql)

-- Per-recording summary template (NULL = derive from recording_type, see summaryTemplates.ts).
ALTER TABLE recordings
ADD COLUMN IF NOT EXISTS summary_template TEXT;

-- The Android client has a "no priority" option and sends priority "none".
-- The original inline CHECK was auto-named todos_priority_check.
ALTER TABLE todos DROP CONSTRAINT IF EXISTS todos_priority_check;
ALTER TABLE todos
ADD CONSTRAINT todos_priority_check CHECK (priority IN ('none', 'low', 'medium', 'high'));
