-- Live status marker (owner decision, 17 Nov 2026): a public, live,
-- colour-coded status derived from the latest GPS position.
--   green  = inside the home range (default 3 miles)
--   amber  = outside the home range
--   red    = inside an active geofence
--   purple = inside a geofence that lies within another active geofence
--   grey   = no current position (stale)
-- The home-range centre and geofence shapes are NEVER exposed publicly.

set search_path = public, extensions;

-- New rule types: private home range and live-status settings.
alter table public.publication_rules drop constraint publication_rules_rule_type_check;
alter table public.publication_rules add constraint publication_rules_rule_type_check check (rule_type in (
  'delay', 'grid', 'exclusion_zone', 'excluded_category', 'area_label', 'pause', 'publish_tracks',
  'home_range',   -- {"lat":..,"lng":..,"radius_m":4828}
  'live_status'   -- {"grid_m":1000}  (enabled = public live marker on)
));

-- Live marker starts OFF until the owner enables it in Settings.
insert into public.publication_rules (rule_type, configuration, enabled)
values ('live_status', '{"grid_m": 1000}', false);

-- Single-row table holding the current computed status.
create table public.live_status (
  id smallint primary key default 1 check (id = 1),
  status text not null default 'unknown'
    check (status in ('green', 'amber', 'red', 'purple', 'unknown')),
  -- Generalised position (grid-cell centre). Null when inside the home range,
  -- inside an exclusion zone, stale, or when the marker is disabled.
  public_lat double precision,
  public_lng double precision,
  cell_size_m integer,
  observed_at timestamptz,
  status_since timestamptz,
  -- Private: precise inputs used to compute the status
  home_inside boolean,
  home_pending_inside boolean,
  home_pending_count integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.live_status (id) values (1);

alter table public.live_status enable row level security;
create policy live_status_admin_all on public.live_status for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.live_status from anon;

-- Pairs of active geofences where `inner_id` lies within `outer_id`.
create or replace function public.geofence_nesting()
returns table (inner_id uuid, outer_id uuid)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select i.id, o.id
  from public.geofences i
  join public.geofences o
    on o.id <> i.id
   and o.status = 'active'
   and st_coveredby(i.geometry::geometry, o.geometry::geometry)
  where i.status = 'active';
$$;
revoke execute on function public.geofence_nesting() from public, anon, authenticated;
grant execute on function public.geofence_nesting() to service_role;

-- Public projection: only status, generalised position and times. The view
-- returns nothing positional unless the owner has enabled the live marker.
create or replace view public.public_live_status as
select
  case when r.enabled then s.status else 'disabled' end as status,
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
