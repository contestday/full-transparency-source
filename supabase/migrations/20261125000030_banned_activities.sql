-- 25 Nov 2026: banned activities (owner decision).
-- Things to do, not places to be. Two kinds:
--   * is_owner: an activity I'm banned from. Public: everyone sees it, in red.
--   * a watcher's: an activity they'd rather I didn't do, on their watch link,
--     as a Wish, Want or Demand. Only they and I see it. None is a legal order.
-- Each is chosen from a short list (kept in system_state "activity_options",
-- not in code) or written as free text. Ending one keeps it on the record.

create table if not exists public.banned_activities (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  is_owner boolean not null default false,
  watcher_id uuid references public.watchers (id) on delete cascade,
  option_key text check (option_key is null or char_length(option_key) <= 40),
  label text not null check (char_length(label) between 1 and 120),
  details text check (details is null or char_length(details) <= 1000),
  level text check (level is null or level in ('wish', 'want', 'demand')),
  status text not null default 'active' check (status in ('active', 'ended')),
  ended_at timestamptz,
  submitter_hash text not null,
  submitter_country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint banned_activities_owner_or_watcher check (is_owner or (watcher_id is not null and level is not null))
);
create index if not exists banned_activities_watcher_idx on public.banned_activities (watcher_id, created_at);
create index if not exists banned_activities_owner_idx on public.banned_activities (is_owner, status, created_at);

alter table public.banned_activities enable row level security;
drop policy if exists banned_activities_admin on public.banned_activities;
create policy banned_activities_admin on public.banned_activities for all using (public.is_admin()) with check (public.is_admin());
