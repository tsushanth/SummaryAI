-- Rollback for migrations/028_voice_debrief.sql. Idempotent. Not applied automatically.
-- Safe at any time: the backend tolerates the columns being absent.

drop index if exists idx_todos_user_summary_item_key;
alter table todos drop constraint if exists todos_source_check;
alter table todos drop column if exists summary_item_key;
alter table todos drop column if exists source;
alter table summaries drop column if exists decisions;
