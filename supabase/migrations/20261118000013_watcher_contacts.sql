-- Watcher-chosen report contacts (18 Nov 2026).
--
-- A watcher can ask for automatic emails to addresses they choose (e.g. a
-- police contact) whenever the GPS record shows entry into one of their areas.
-- An address receives alerts only after its owner confirms by following a link
-- sent to it, and every alert carries a one-click stop link. The watchers
-- table itself still holds no email, name or phone (see security tests).
-- Private: server (service role) only.

create table public.watcher_contacts (
  id uuid primary key default gen_random_uuid(),
  watcher_id uuid not null references public.watchers (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  confirm_token_hash text not null,
  stop_token_hash text not null,
  confirmed_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  unique (watcher_id, email)
);
create index watcher_contacts_watcher_idx on public.watcher_contacts (watcher_id);
create unique index watcher_contacts_confirm_idx on public.watcher_contacts (confirm_token_hash);
create unique index watcher_contacts_stop_idx on public.watcher_contacts (stop_token_hash);

alter table public.watcher_contacts enable row level security;
revoke all on public.watcher_contacts from anon, authenticated;
