-- Slice C: folders, recording->folder assignment, and public share links.
-- Additive only. NOT applied to any live project; apply manually after review.
-- Every new table has RLS enabled. The backend uses the service role (bypasses RLS)
-- and scopes every query to the authenticated user id; the policies below protect
-- direct PostgREST/anon access. No policy grants anon or public access to any row.

-- ----- Folders -----
create table if not exists folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists folders_user_name_unique on folders(user_id, lower(btrim(name)));
create index if not exists folders_user_idx on folders(user_id);

alter table folders enable row level security;

drop policy if exists folders_select on folders;
create policy folders_select on folders for select using (auth.uid() = user_id);
drop policy if exists folders_insert on folders;
create policy folders_insert on folders for insert with check (auth.uid() = user_id);
drop policy if exists folders_update on folders;
create policy folders_update on folders for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists folders_delete on folders;
create policy folders_delete on folders for delete using (auth.uid() = user_id);

-- ----- recordings.folder_id (deleting a folder un-files its recordings, never deletes them) -----
alter table recordings add column if not exists folder_id uuid references folders(id) on delete set null;
create index if not exists idx_recordings_user_folder on recordings(user_id, folder_id);
-- tags (text[]) and is_favorite already exist on recordings; GIN index on tags exists from 001.

-- ----- Public share links -----
-- Only the SHA-256 hash of the token is stored, so a database leak does not expose live links.
create table if not exists recording_shares (
  id                 uuid primary key default gen_random_uuid(),
  recording_id       uuid not null references recordings(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  token_hash         text not null unique check (char_length(token_hash) = 64),
  include_transcript boolean not null default false,
  expires_at         timestamptz,
  revoked_at         timestamptz,
  view_count         integer not null default 0,
  last_viewed_at     timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists recording_shares_recording_idx on recording_shares(recording_id);
create index if not exists recording_shares_user_idx on recording_shares(user_id);

alter table recording_shares enable row level security;

drop policy if exists recording_shares_select on recording_shares;
create policy recording_shares_select on recording_shares for select using (auth.uid() = user_id);
drop policy if exists recording_shares_insert on recording_shares;
create policy recording_shares_insert on recording_shares for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from recordings r where r.id = recording_id and r.user_id = auth.uid())
  );
drop policy if exists recording_shares_update on recording_shares;
create policy recording_shares_update on recording_shares for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists recording_shares_delete on recording_shares;
create policy recording_shares_delete on recording_shares for delete using (auth.uid() = user_id);

-- Atomic view counter used by the public endpoint (service role only).
create or replace function increment_share_view(p_share_id uuid) returns void as $$
  update recording_shares set view_count = view_count + 1, last_viewed_at = now() where id = p_share_id;
$$ language sql security definer set search_path = public;
revoke all on function increment_share_view(uuid) from public, anon, authenticated;
