-- Rollback for migrations/030_live_stt_fallback.sql. Idempotent. Not applied automatically.
-- Run only after the backend code that selects live_stt_fallback is rolled back. The code tolerates the column being absent
-- (fallback is then unavailable and Soniox stays the visible source), so dropping it never breaks reads.
-- Hidden standby rows (live_transcripts.shadow = true with source_key null) are left alone; delete them by hand if wanted:
--   delete from live_transcripts where shadow = true and source_key is null;   (left commented on purpose)

alter table bot_runs drop column if exists live_stt_fallback;
