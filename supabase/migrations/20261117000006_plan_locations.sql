-- Plans: multiple locations per plan, and recurring series (17 Nov 2026).

set search_path = public, extensions;

-- Additional locations for a plan (the first location stays in
-- planned_activities.venue_id). Public fields are computed server-side using
-- the venue privacy rule: public venues in full, private addresses by area.
create table public.plan_locations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planned_activities (id) on delete cascade,
  position smallint not null,
  venue_id uuid not null references public.venues (id) on delete cascade,
  public_venue_name text,
  public_area_label text,
  public_lat double precision,
  public_lng double precision,
  public_cell_size_m integer,
  created_at timestamptz not null default now(),
  unique (plan_id, position)
);
create index plan_locations_plan_idx on public.plan_locations (plan_id);

alter table public.plan_locations enable row level security;
create policy plan_locations_admin_all on public.plan_locations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.plan_locations from anon;

-- Recurring plans share a series id.
alter table public.planned_activities add column series_id uuid;
create index planned_activities_series_idx on public.planned_activities (series_id);

-- Public projection of extra locations, only for plans that are themselves public.
create or replace view public.public_plan_locations as
select
  l.plan_id,
  l.position,
  l.public_venue_name as venue_name,
  l.public_area_label as area_label,
  l.public_lat,
  l.public_lng,
  l.public_cell_size_m
from public.plan_locations l
join public.public_plans p on p.id = l.plan_id;

grant select on public.public_plan_locations to anon, authenticated;
