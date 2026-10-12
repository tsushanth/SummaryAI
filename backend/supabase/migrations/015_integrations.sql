-- Outbound integrations (webhook / Slack / Notion) + delivery log.
-- Additive only. NOT applied automatically; review and apply manually.
-- All secrets (webhook URL, signing secret, Slack URL, Notion token) are stored
-- AES-256-GCM encrypted by the backend (encryptionService). Only the service role
-- touches the integrations table; clients never read ciphertext.

create table if not exists user_integrations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  kind            text not null check (kind in ('webhook', 'slack', 'notion')),
  enabled         boolean not null default true,
  url_encrypted   text,               -- webhook URL or Slack incoming-webhook URL
  secret_encrypted text,              -- webhook HMAC secret or Notion token
  config          jsonb not null default '{}'::jsonb, -- non-secret: notion database_id, display host
  last_status     text,               -- 'success' | 'failed'
  last_error      text,
  last_delivered_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, kind)
);

create table if not exists integration_deliveries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('webhook', 'slack', 'notion')),
  recording_id   uuid references recordings(id) on delete set null,
  event          text not null,       -- 'recording.completed' | 'test'
  status         text not null check (status in ('success', 'failed')),
  attempts       integer not null default 1,
  response_status integer,
  error          text,
  created_at     timestamptz not null default now()
);

create index if not exists integration_deliveries_user_idx
  on integration_deliveries(user_id, created_at desc);

alter table user_integrations      enable row level security;
alter table integration_deliveries enable row level security;

-- Ciphertext never leaves the server: no client policy grants access to user_integrations.
drop policy if exists user_integrations_no_client_access on user_integrations;
create policy user_integrations_no_client_access on user_integrations
  for all using (false) with check (false);

drop policy if exists integration_deliveries_select_own on integration_deliveries;
create policy integration_deliveries_select_own on integration_deliveries
  for select using (auth.uid() = user_id);
-- Writes happen only through the backend with the service role (bypasses RLS).
