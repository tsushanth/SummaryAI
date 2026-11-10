-- Per-meeting transcription language (see backend/LIVE_STT.md, "Transcription language"). NOT applied to any project;
-- ask -af (the session that operates the MeetingMind Supabase project) to apply it. Idempotent.
-- Rollback: backend/supabase/rollbacks/027_transcription_language_down.sql
--
-- The backend is written to work BEFORE this is applied: it only writes these columns when a language is chosen, retries the
-- insert/update without them if the database says the column does not exist, and reads them tolerantly. Until it is applied a
-- chosen language is ignored (auto-detect) and the API says so with a warning; the user's default language lives in
-- profiles.preferences and works without any migration.
--
-- meetings.transcription_language    NULL = never chosen (follows the owner's default when the bot joins); 'auto' = explicitly
--                                    auto-detect; otherwise an allow-listed BCP-47 primary subtag ('es', 'fr', ...).
-- bot_runs.transcription_language    the language this bot actually started with / was last switched to. NULL = auto.

alter table meetings
  add column if not exists transcription_language text;

alter table bot_runs
  add column if not exists transcription_language text;
