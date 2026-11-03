-- Live STT provider support (see backend/LIVE_STT.md). NOT applied to any project; apply manually after review.
-- Idempotent. Rollback: backend/supabase/rollbacks/026_live_stt_down.sql
--
-- MUST be applied BEFORE deploying the backend that contains the shadow=false reader filters (every reader of
-- live_transcripts selects on `shadow`; without the column those queries fail and the live transcript goes empty).
-- Adding columns with a constant default is a metadata-only change on Postgres 11+ (no table rewrite).
--
-- live_transcripts.source_key  idempotency key for rows written by POST /internal/live-segments. NULL for rows written by the
--                              Recall webhook (webhooks.ts), so the existing path is unchanged. A plain UNIQUE index (NULLs are
--                              distinct) rather than a partial one, because PostgREST's upsert/ON CONFLICT (source_key) cannot
--                              target a partial index predicate.
-- live_transcripts.shadow      true = written by the shadow A/B run (Soniox next to Recall). Every reader filters shadow = false.
-- bot_runs.live_stt_ref        id minted by createBot BEFORE the Recall call; the live-stt service sends it back so the backend can
--                              find the bot run (recall_bot_id is only stored after Recall answers).
-- bot_runs.live_stt_provider   'recall' (default, today's behaviour), 'soniox', or 'shadow'.

alter table live_transcripts
  add column if not exists source_key text;

alter table live_transcripts
  add column if not exists shadow boolean not null default false;

create unique index if not exists uq_live_transcripts_source_key
  on live_transcripts (source_key);

alter table bot_runs
  add column if not exists live_stt_ref text;

alter table bot_runs
  add column if not exists live_stt_provider text default 'recall';

create unique index if not exists uq_bot_runs_live_stt_ref
  on bot_runs (live_stt_ref);
