-- Assistant tools: link action items to todos, and a place for extracted decisions. NOT applied to any project;
-- apply it by hand through the session that operates the MeetingMind Supabase project. Idempotent, additive, nullable.
-- Rollback: backend/supabase/rollbacks/028_voice_debrief_down.sql
--
-- The backend works BEFORE this is applied: routes/voiceTools.ts saves a todo without the new columns when the database says
-- they do not exist, matches summary items to todos by title, and reads summaries.decisions defensively (null when absent).
--
-- todos.source             where the todo came from: 'manual' (default), 'summary' (imported from a summary) or 'voice'.
-- todos.summary_item_key   stable key of the summary action item it was created from (see services/voiceTools.ts summaryItemKey),
--                          so "open"/"done" stay consistent instead of matching on title text.
-- summaries.decisions      decisions extracted from the meeting, [{text, quote, at_seconds}]. Filled later; null until then.
--
-- No new tables or functions are created here, so there is nothing new to revoke from anon/authenticated: the existing table
-- grants and the own-row policy on todos are unchanged. (A later migration that adds a table MUST enable RLS and revoke anon and
-- authenticated explicitly: this project's default privileges still grant them on new objects.)

alter table todos
  add column if not exists source text not null default 'manual',
  add column if not exists summary_item_key text;

alter table todos drop constraint if exists todos_source_check;
alter table todos add constraint todos_source_check check (source in ('manual', 'summary', 'voice'));

create index if not exists idx_todos_user_summary_item_key on todos (user_id, summary_item_key) where summary_item_key is not null;

alter table summaries
  add column if not exists decisions jsonb;
