-- Rollback for migrations/025_stt_shadow_runs.sql. NOT applied anywhere. Safe to repeat. The table only holds
-- comparison metrics; dropping it loses the shadow results and nothing else (set STT_PROVIDER back to deepgram first,
-- otherwise shadow rows fail to insert and are only logged).
drop index if exists stt_shadow_runs_recording_idx;
drop index if exists stt_shadow_runs_created_idx;
drop table if exists stt_shadow_runs;
