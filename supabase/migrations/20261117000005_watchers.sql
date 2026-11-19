-- Private watch links (owner decision, 17 Nov 2026).
-- Anyone who submits areas gets a private, unguessable watch link. Through it
-- they (and only they) see the marker coloured against THEIR areas:
--   red    = inside one of their areas
--   purple = inside one of their areas that lies within another of theirs
--   otherwise green / amber from the home okay zone
-- and can opt in to push notifications on entry/exit of their areas.
-- The PUBLIC marker no longer shows red/purple at all: only green / amber /
-- grey, so nobody sees a "breach" of an area they know nothing about.

set search_path = public, extensions;

create table public.watchers (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,           -- sha256 of the secret token; token itself never stored
  status text not null default 'active' check (status in ('active', 'revoked')),
  submitter_hash text,                        -- salted IP hash, abuse correlation only
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table public.geofences add column watcher_id uuid references public.watchers (id) on delete set null;
create index geofences_watcher_idx on public.geofences (watcher_id);

create table public.watcher_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  watcher_id uuid not null references public.watchers (id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.watchers enable row level security;
alter table public.watcher_push_subscriptions enable row level security;
create policy watchers_admin_all on public.watchers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy watcher_push_subscriptions_admin_all on public.watcher_push_subscriptions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.watchers from anon;
revoke all on public.watcher_push_subscriptions from anon;

-- Home-only colour (green / amber / unknown), computed by the server.
alter table public.live_status add column public_status text not null default 'unknown'
  check (public_status in ('green', 'amber', 'unknown'));

-- Public marker: home-based colour only. Same columns as before.
create or replace view public.public_live_status as
select
  case when r.enabled then s.public_status else 'disabled' end as status,
  case when r.enabled then s.public_lat end as public_lat,
  case when r.enabled then s.public_lng end as public_lng,
  case when r.enabled then s.cell_size_m end as cell_size_m,
  case when r.enabled then s.observed_at end as observed_at,
  case when r.enabled then s.status_since end as status_since,
  case when r.enabled then s.updated_at end as updated_at
from public.live_status s
cross join lateral (
  select coalesce(
    (select enabled from public.publication_rules where rule_type = 'live_status' order by updated_at desc limit 1),
    false
  ) as enabled
) r
where s.id = 1;
grant select on public.public_live_status to anon, authenticated;

-- Admin geofence listing gains watcher_id (new columns go last).
create or replace view public.geofences_geojson
with (security_invoker = true) as
select
  f.id, f.reference, f.shape_type, f.center_lat, f.center_lng, f.radius_m,
  f.description, f.category, f.origin, f.verification_status, f.moderation_status,
  f.status, f.submitted_at, f.updated_at,
  st_asgeojson(f.geometry)::jsonb as geojson,
  coalesce(s.inside, false) as currently_inside,
  f.watcher_id
from public.geofences f
left join public.geofence_state s on s.geofence_id = f.id;
