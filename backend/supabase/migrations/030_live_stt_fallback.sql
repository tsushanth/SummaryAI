-- Live STT automatic fallback state (see backend/LIVE_STT.md, "Soniox primary with Recall fallback"). NOT applied to any project;
-- apply manually after review. Idempotent. Rollback: backend/supabase/rollbacks/030_live_stt_fallback_down.sql
--
-- bot_runs.live_stt_fallback  per-meeting fallback state, NULL = never switched (Soniox is the visible source).
--                             {"v":1,"active":bool,"switched_at_sec":n,"switched_at":iso,"reason":text,"retries_used":0|1,
--                              "events":[{"t":iso,"kind":"to_recall"|"to_soniox","reason":text,"at_sec":n}]}
--                             No transcript text, names or ids. The backend reads it on every live segment, so it must exist
--                             before LIVE_STT_FALLBACK is left on for any user. Adding a nullable column is metadata-only.

alter table bot_runs
  add column if not exists live_stt_fallback jsonb;
