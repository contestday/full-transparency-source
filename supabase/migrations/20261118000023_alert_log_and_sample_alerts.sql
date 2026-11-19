-- Alert log for the on-site popup, and one device on several watch links
-- (18 Nov 2026). Apply after 0022.
--
-- watcher_alerts: what each watch link was alerted about (kind, area
-- reference, times). No area names or positions: the watcher's own page adds
-- the names (Locations are sealed). Kept 30 days. Server only.
--
-- A device can now get notifications for more than one watch link (e.g. its
-- own and the public sample): unique per (watch link, device) instead of per
-- device.

create table if not exists public.watcher_alerts (
  id bigint generated always as identity primary key,
  watcher_id uuid not null references public.watchers (id) on delete cascade,
  event text not null check (event in ('enter', 'exit', 'still')),
  tier text,
  outside boolean not null default false,
  reference text not null,
  since timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists watcher_alerts_watcher_idx on public.watcher_alerts (watcher_id, created_at desc);
alter table public.watcher_alerts enable row level security;
revoke all on public.watcher_alerts from anon, authenticated;

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.watcher_push_subscriptions'::regclass and contype = 'u'
  loop
    execute format('alter table public.watcher_push_subscriptions drop constraint %I', c.conname);
  end loop;
end $$;
drop index if exists public.watcher_push_subscriptions_endpoint_key;
create unique index if not exists watcher_push_subscriptions_watcher_endpoint_key
  on public.watcher_push_subscriptions (watcher_id, endpoint);
