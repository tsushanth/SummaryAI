-- Todos: persist the assignee carried over from meeting action items.
-- due_date already exists (004). No new tables, so no new RLS policies; the existing
-- "Users can manage their own todos" policy covers the new column.
-- The user's default summary template lives in profiles.preferences.default_summary_template.
ALTER TABLE todos ADD COLUMN IF NOT EXISTS assignee TEXT;
