-- Audit + rate-limit log for "email this summary" (one row per recipient attempt).
-- Additive only. The backend uses the service role and scopes every query to the
-- authenticated user id; the policy below only protects direct PostgREST access.
-- Recipient addresses are typed by the owner per send and are not copied from calendar
-- attendees (see backend/DATA_SEGREGATION.md).

create table if not exists summary_email_sends (
  id              uuid primary key default gen_random_uuid(),
  recording_id    uuid not null references recordings(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null check (char_length(recipient_email) <= 254),
  status          text not null check (status in ('sent', 'failed')),
  created_at      timestamptz not null default now()
);

create index if not exists summary_email_sends_user_created_idx on summary_email_sends(user_id, created_at desc);
create index if not exists summary_email_sends_recording_idx on summary_email_sends(recording_id);

alter table summary_email_sends enable row level security;

drop policy if exists summary_email_sends_select on summary_email_sends;
create policy summary_email_sends_select on summary_email_sends for select using (auth.uid() = user_id);
-- No insert/update/delete policies: only the backend (service role) writes these rows.
