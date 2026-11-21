-- 21 Nov 2026: Events.
-- A watcher can mark an event (a concert, a few days in a town) as somewhere
-- they'd rather I wasn't, for that time only. Unlike Locations, events are
-- not sealed: I see the event, its places and its times, and so does the
-- watcher who set it. Nothing about events is public.
--
--   * Set at least 48 hours ahead (checked here and in the API), up to 5 years ahead.
--   * Any length. It counts only between its start and end; afterwards it's kept
--     on the record as ended.
--   * Levels: wish, want, demand. None is a legal order.
--   * Repeating events (weekly, on chosen days and times) count only during each time.
--   * includes_home: one of its places includes my home. I'm never expected to
--     leave home for it; time at home never counts.

create table if not exists public.watch_events (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  watcher_id uuid not null references public.watchers (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  details text check (details is null or char_length(details) <= 2000),
  level text not null check (level in ('wish', 'want', 'demand')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at timestamptz,
  includes_home boolean not null default false,
  -- Repeating events: {"freq":"weekly","days":[4],"start_time":"18:00","end_time":"22:00"}
  -- (UK time). starts_at / ends_at then span the whole series (first start, last end).
  recurrence jsonb,
  submitter_hash text not null,
  submitter_country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists watch_events_watcher_idx on public.watch_events (watcher_id, starts_at);
create index if not exists watch_events_window_idx on public.watch_events (status, starts_at, ends_at);

-- Never retrospective or at short notice.
create or replace function public.watch_events_notice()
returns trigger
language plpgsql
as $$
begin
  if new.starts_at < now() + interval '48 hours' then
    raise exception 'An event must be set at least 48 hours before it starts';
  end if;
  if new.starts_at > now() + interval '5 years 1 day' then
    raise exception 'An event can be set up to 5 years ahead';
  end if;
  return new;
end;
$$;
drop trigger if exists watch_events_notice on public.watch_events;
create trigger watch_events_notice before insert on public.watch_events
  for each row execute function public.watch_events_notice();

create table if not exists public.watch_event_places (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.watch_events (id) on delete cascade,
  position int not null default 0,
  name text not null check (char_length(name) between 1 and 200),
  kind text not null check (kind in ('venue', 'place')),
  center_lat double precision not null,
  center_lng double precision not null,
  radius_m real,
  geojson jsonb not null,
  area_m2 double precision not null
);
create index if not exists watch_event_places_event_idx on public.watch_event_places (event_id, position);

-- Whether I'm currently inside each place (only while its event is on).
create table if not exists public.watch_event_state (
  place_id uuid primary key references public.watch_event_places (id) on delete cascade,
  inside boolean not null default false,
  since timestamptz,
  last_observed_at timestamptz
);

-- The record: when I entered and left each event's places.
create table if not exists public.watch_event_log (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.watch_events (id) on delete cascade,
  place_id uuid references public.watch_event_places (id) on delete set null,
  event_type text not null check (event_type in ('enter', 'exit')),
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists watch_event_log_event_idx on public.watch_event_log (event_id, observed_at);

alter table public.watch_events enable row level security;
alter table public.watch_event_places enable row level security;
alter table public.watch_event_state enable row level security;
alter table public.watch_event_log enable row level security;

drop policy if exists watch_events_admin on public.watch_events;
create policy watch_events_admin on public.watch_events for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists watch_event_places_admin on public.watch_event_places;
create policy watch_event_places_admin on public.watch_event_places for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists watch_event_state_admin on public.watch_event_state;
create policy watch_event_state_admin on public.watch_event_state for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists watch_event_log_admin on public.watch_event_log;
create policy watch_event_log_admin on public.watch_event_log for all using (public.is_admin()) with check (public.is_admin());

revoke all on public.watch_events from anon;
revoke all on public.watch_event_places from anon;
revoke all on public.watch_event_state from anon;
revoke all on public.watch_event_log from anon;
