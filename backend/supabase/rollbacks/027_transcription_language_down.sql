-- Rollback for migrations/027_transcription_language.sql. Idempotent. Not applied automatically.
-- Safe at any time: the backend tolerates the columns being absent (it retries without them and reads them defensively).

alter table bot_runs drop column if exists transcription_language;
alter table meetings drop column if exists transcription_language;
