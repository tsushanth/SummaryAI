-- Account purge ledger (see backend/src/services/accountPurge.ts). NOT applied to any project; apply manually after review.
-- Idempotent. Rollback: backend/supabase/rollbacks/024_account_purges_down.sql
--
-- One row per purged account. It exists so a purge that fails at Recall.ai / Twilio / storage can be finished by the
-- retry loop AFTER the user's own rows and auth user are gone, and so two instances never purge the same user at once.
--
-- Privacy: no content. user_ref is a one-way SHA-256 of the user id. user_id is deliberately NOT a foreign key to
-- auth.users (the auth user is deleted before the purge is finished) and is set to NULL when the purge completes.
-- `pending` holds only opaque identifiers still to delete (storage paths under <user id>/, Recall bot ids, Twilio
-- recording SIDs) and is emptied on completion. `counts` holds integers.

create table if not exists account_purges (
  id               uuid primary key default gen_random_uuid(),
  user_ref         text not null unique check (char_length(user_ref) = 64),
  user_id          uuid,
  status           text not null default 'running'
                     check (status in ('running', 'pending_external', 'failed', 'needs_attention', 'complete')),
  pending          jsonb not null default '{"storage": [], "recall": [], "twilio": []}'::jsonb,
  counts           jsonb not null default '{}'::jsonb,
  attempts         integer not null default 0,
  next_attempt_at  timestamptz,
  locked_until     timestamptz,
  last_error_class text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index if not exists account_purges_retry_idx
  on account_purges (status, updated_at)
  where status in ('pending_external', 'failed', 'running') and user_id is not null;

-- Service role only: RLS on, no policies, so anon/authenticated PostgREST access sees nothing.
alter table account_purges enable row level security;
