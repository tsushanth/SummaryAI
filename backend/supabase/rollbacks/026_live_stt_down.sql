-- Rollback for migrations/026_live_stt.sql. Idempotent. Not applied automatically.
-- Run ONLY after the backend code that selects on `shadow` / writes source_key is rolled back (see backend/LIVE_STT.md):
-- the shipped readers filter on live_transcripts.shadow and fail without the column.
-- Dropping `shadow` turns shadow-run rows into ordinary visible rows, so delete them first if you do not want that:
--   delete from live_transcripts where shadow = true;   (left commented on purpose)

drop index if exists uq_bot_runs_live_stt_ref;
drop index if exists uq_live_transcripts_source_key;

alter table bot_runs drop column if exists live_stt_provider;
alter table bot_runs drop column if exists live_stt_ref;

alter table live_transcripts drop column if exists shadow;
alter table live_transcripts drop column if exists source_key;
