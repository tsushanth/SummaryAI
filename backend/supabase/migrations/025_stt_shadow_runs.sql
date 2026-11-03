-- STT shadow comparison log (see backend/src/services/stt/). NOT applied to any project; apply manually after review.
-- Idempotent. Rollback: backend/supabase/rollbacks/025_stt_shadow_runs_down.sql
--
-- One row per recording processed while STT_PROVIDER=shadow: the primary (Deepgram) result vs the shadow (Soniox) result.
-- Privacy: COUNTS AND METRICS ONLY. No transcript text, no audio, no file path, no user id, no title. recording_id is an
-- opaque id; it is a foreign key with ON DELETE CASCADE so deleting a recording or an account (which deletes its
-- recordings) deletes its comparison row too. wer_vs_primary is the normalized word error rate of the shadow text
-- measured against the PRIMARY text: it is a disagreement rate, not accuracy against ground truth.

create table if not exists stt_shadow_runs (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  recording_id             uuid references recordings(id) on delete cascade,
  primary_provider         text not null,
  primary_model            text not null,
  shadow_provider          text not null,
  shadow_model             text not null,
  status                   text not null check (status in ('ok', 'shadow_error', 'shadow_timeout', 'shadow_empty')),
  error_class              text,
  primary_word_count       integer not null,
  shadow_word_count        integer,
  primary_duration_seconds numeric(10, 2),
  shadow_duration_seconds  numeric(10, 2),
  primary_language         text not null,
  shadow_language          text,
  primary_speaker_count    integer not null,
  shadow_speaker_count     integer,
  wer_vs_primary           numeric(8, 4),
  primary_latency_ms       integer not null,
  shadow_latency_ms        integer
);

create index if not exists stt_shadow_runs_created_idx on stt_shadow_runs (created_at desc);
create index if not exists stt_shadow_runs_recording_idx on stt_shadow_runs (recording_id);

-- Service role only: RLS on, no policies, so anon/authenticated PostgREST access sees nothing.
alter table stt_shadow_runs enable row level security;
