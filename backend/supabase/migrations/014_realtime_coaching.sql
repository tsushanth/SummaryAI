-- Realtime AI Coaching — per-meeting persona-based agent (Sales Discovery, etc.)
-- Monetized as consumable IAP credits + capped subscription. See REALTIME_COACHING.md.

-- ----- Credits ledger -----
create table if not exists coaching_credits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source      text not null check (source in ('free', 'iap', 'subscription', 'refund', 'manual')),
  product_id  text,                       -- iap product id; null for free + subscription + manual
  balance     integer not null check (balance >= 0),
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,                -- subscription credits roll over monthly; consumable + free never expire
  source_event_id text,                   -- iap transaction id / subscription event id for idempotency
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists coaching_credits_user_idx     on coaching_credits(user_id) where balance > 0;
create index if not exists coaching_credits_event_idx    on coaching_credits(source_event_id) where source_event_id is not null;
create unique index if not exists coaching_credits_event_unique
  on coaching_credits(source_event_id) where source_event_id is not null;

-- ----- Coaching sessions -----
create table if not exists coaching_sessions (
  id            uuid primary key default gen_random_uuid(),
  recording_id  uuid not null references recordings(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  persona       text not null,
  credit_id     uuid references coaching_credits(id),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  insight_count integer not null default 0,
  refunded      boolean not null default false,
  refund_reason text
);

create index if not exists coaching_sessions_user_idx     on coaching_sessions(user_id);
create index if not exists coaching_sessions_recording_idx on coaching_sessions(recording_id);
create unique index if not exists coaching_sessions_recording_unique
  on coaching_sessions(recording_id) where ended_at is null;  -- one open session per recording

-- ----- Emitted insights -----
create table if not exists coaching_insights (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references coaching_sessions(id) on delete cascade,
  type         text not null check (type in ('question','objection','signal','gap')),
  text         text not null,
  urgency      text not null check (urgency in ('now','soon','before-end')),
  transcript_offset_seconds integer,
  emitted_at   timestamptz not null default now()
);

create index if not exists coaching_insights_session_idx on coaching_insights(session_id);

-- ----- Triggers for updated_at -----
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists coaching_credits_touch on coaching_credits;
create trigger coaching_credits_touch before update on coaching_credits
  for each row execute function set_updated_at();

-- ----- Row Level Security -----
alter table coaching_credits  enable row level security;
alter table coaching_sessions enable row level security;
alter table coaching_insights enable row level security;

create policy coaching_credits_self_read  on coaching_credits  for select using (user_id = auth.uid());
create policy coaching_sessions_self_read on coaching_sessions for select using (user_id = auth.uid());
create policy coaching_insights_self_read on coaching_insights for select
  using (session_id in (select id from coaching_sessions where user_id = auth.uid()));

-- Service-role bypasses RLS automatically; the policies above only protect direct PostgREST/anon access.
