-- First-party activation funnel (see backend/src/routes/activation.ts). NOT applied to any project; apply manually after review (ask session -af).
-- Idempotent. Rollback: backend/supabase/rollbacks/027_activation_events_down.sql
--
-- activation_events: anonymous, allow-listed funnel events (landed, signup_started, signup_done, record_clicked,
--   first_recording_started, first_recording_done, summary_viewed, sample_viewed, upload_chosen).
--   anon_id is a random id the browser generates; user_id is set only when a valid Bearer token came with the event and is NOT a
--   foreign key (the purge deletes these rows explicitly, see USER_TABLES in accountPurgeAdapters.ts).
--   props holds numbers, booleans and short enum strings only (enforced in the route, max 8 keys). No IPs, no user agents, no free text.
-- signup_attribution: where a web signup came from (utm_*, referrer host, landing path). One row per user, first write wins.
--
-- Security: RLS ON with NO policies, so only the service role (the backend) can read or write. anon/authenticated get nothing.

create table if not exists activation_events (
  id          bigserial primary key,
  anon_id     text not null check (char_length(anon_id) between 16 and 64),
  user_id     uuid,
  name        text not null check (name in ('landed','signup_started','signup_done','record_clicked','first_recording_started','first_recording_done','summary_viewed','sample_viewed','upload_chosen')),
  props       jsonb not null default '{}'::jsonb,
  platform    text not null default 'web',
  app_version text,
  created_at  timestamptz not null default now()
);
create index if not exists activation_events_name_created_idx on activation_events (name, created_at);
create index if not exists activation_events_anon_idx on activation_events (anon_id);
create index if not exists activation_events_user_idx on activation_events (user_id);
alter table activation_events enable row level security;

create table if not exists signup_attribution (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  anon_id       text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  referrer_host text,
  landing_path  text,
  platform      text not null default 'web',
  created_at    timestamptz default now()
);
alter table signup_attribution enable row level security;

-- Defence in depth: nothing for the public API roles, even if a policy is added by mistake later.
revoke all on activation_events from anon, authenticated;
revoke all on signup_attribution from anon, authenticated;
revoke all on sequence activation_events_id_seq from anon, authenticated;
