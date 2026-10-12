-- Detailed summary: a fuller write-up stored beside the short summary.
-- Additive and nullable; existing summaries keep NULL until regenerated.
ALTER TABLE summaries ADD COLUMN IF NOT EXISTS detailed_summary TEXT;
