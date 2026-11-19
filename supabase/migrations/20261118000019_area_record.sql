-- Wish / Want / Location, and a timestamped record of watch areas (18 Nov 2026).
-- Apply after 0018.
--
-- Owner decision, 18 Nov 2026 20:00 GMT ("the line in the sand"):
--   * Wish (wide) and Want (local) areas are shown to the owner. Want areas are
--     no longer sealed: they are stored like wish areas. Locations stay sealed
--     (private to their watcher).
--   * Every watch area has the time it came into effect (effective_from). No
--     area counts from before 2026-11-18 20:00 GMT: areas set earlier count
--     from then. Changing an area's shape, kind or direction starts a new
--     effective time, so a new or enlarged area never applies to the past.
--   * geofence_versions keeps every version of every watch area with its
--     effective times. It records what was set and when, never who set it.
--     Rows can't be deleted, and only an open version's end time can be set.

set search_path = public, extensions;

-- When an area came into effect.
alter table public.geofences add column if not exists effective_from timestamptz;
update public.geofences
set effective_from = greatest(coalesce(updated_at, submitted_at), timestamptz '2026-11-18 20:00:00+00')
where watcher_id is not null and effective_from is null;

-- The record.
create table if not exists public.geofence_versions (
  id bigint generated always as identity primary key,
  geofence_id uuid not null references public.geofences (id),
  reference text not null,
  tier text,
  wide_mode text,
  shape_type text,
  geometry geography(Geometry, 4326),
  description text,
  sealed text,
  effective_from timestamptz not null,
  effective_until timestamptz,
  recorded_at timestamptz not null default now()
);
create index if not exists geofence_versions_fence_idx on public.geofence_versions (geofence_id, effective_from);

-- Append-only: no deletes; an update may only close an open version, or (when
-- a sealed Want area is opened up, flag ft.reveal) add its plain shape.
create or replace function public.geofence_versions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'The area record cannot be deleted';
  end if;
  if current_setting('ft.reveal', true) = '1'
     and new.effective_from = old.effective_from and new.effective_until is not distinct from old.effective_until then
    return new;
  end if;
  if old.effective_until is not null
     or new.effective_until is null
     or new.geofence_id <> old.geofence_id or new.reference <> old.reference
     or new.tier is distinct from old.tier or new.wide_mode is distinct from old.wide_mode
     or new.effective_from <> old.effective_from or new.sealed is distinct from old.sealed
     or new.description is distinct from old.description
     or not (new.geometry::geometry is not distinct from old.geometry::geometry) then
    raise exception 'The area record can only be closed, not changed';
  end if;
  return new;
end;
$$;
drop trigger if exists geofence_versions_guard on public.geofence_versions;
create trigger geofence_versions_guard before update or delete on public.geofence_versions
  for each row execute function public.geofence_versions_guard();

-- A new effective time when a watch area's meaning changes.
create or replace function public.geofences_effective_from()
returns trigger
language plpgsql
as $$
declare
  line constant timestamptz := timestamptz '2026-11-18 20:00:00+00';
begin
  if new.watcher_id is null then
    return new;
  end if;
  if current_setting('ft.reveal', true) = '1' then
    return new; -- same area, only its storage changed
  end if;
  if tg_op = 'INSERT'
     or new.tier is distinct from old.tier
     or new.wide_mode is distinct from old.wide_mode
     or new.sealed is distinct from old.sealed
     or not (new.geometry::geometry is not distinct from old.geometry::geometry) then
    new.effective_from := greatest(now(), line);
  end if;
  return new;
end;
$$;
drop trigger if exists geofences_effective_from on public.geofences;
create trigger geofences_effective_from before insert or update on public.geofences
  for each row execute function public.geofences_effective_from();

-- Keep the record in step with the areas.
create or replace function public.geofences_record_version()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.watcher_id is null then
    return new;
  end if;
  if current_setting('ft.reveal', true) = '1' then
    update public.geofence_versions
       set geometry = new.geometry, shape_type = new.shape_type, description = new.description, sealed = new.sealed
     where geofence_id = new.id and effective_until is null;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = old.status
     and new.tier is not distinct from old.tier and new.wide_mode is not distinct from old.wide_mode
     and new.sealed is not distinct from old.sealed
     and (new.geometry::geometry is not distinct from old.geometry::geometry) then
    return new; -- nothing that matters changed
  end if;
  update public.geofence_versions
     set effective_until = greatest(now(), timestamptz '2026-11-18 20:00:00+00')
   where geofence_id = new.id and effective_until is null;
  if new.status = 'active' then
    insert into public.geofence_versions (geofence_id, reference, tier, wide_mode, shape_type, geometry, description, sealed, effective_from)
    values (new.id, new.reference, new.tier, new.wide_mode, new.shape_type, new.geometry, new.description, new.sealed, new.effective_from);
  end if;
  return new;
end;
$$;
drop trigger if exists geofences_record_version on public.geofences;
create trigger geofences_record_version after insert or update on public.geofences
  for each row execute function public.geofences_record_version();

-- Start the record with every active watch area as it is now.
insert into public.geofence_versions (geofence_id, reference, tier, wide_mode, shape_type, geometry, description, sealed, effective_from)
select f.id, f.reference, f.tier, f.wide_mode, f.shape_type, f.geometry, f.description, f.sealed, f.effective_from
from public.geofences f
where f.watcher_id is not null and f.status = 'active'
  and not exists (select 1 from public.geofence_versions v where v.geofence_id = f.id);

-- Open up a sealed Want area (called with the watcher's link present), keeping its effective time.
create or replace function public.reveal_want_area(
  p_id uuid, p_geojson text, p_shape_type text, p_center_lat double precision, p_center_lng double precision, p_radius_m real, p_description text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_geom geometry := st_setsrid(st_geomfromgeojson(p_geojson), 4326);
begin
  if not st_isvalid(v_geom) then v_geom := st_collectionextract(st_makevalid(v_geom), 3); end if;
  if st_numgeometries(v_geom) = 1 then v_geom := st_geometryn(v_geom, 1); end if;
  perform set_config('ft.reveal', '1', true);
  update public.geofences
     set geometry = v_geom::geography, shape_type = p_shape_type, center_lat = p_center_lat, center_lng = p_center_lng,
         radius_m = p_radius_m, description = p_description, sealed = null, updated_at = now()
   where id = p_id and tier = 'local' and sealed is not null;
  perform set_config('ft.reveal', '0', true);
end;
$$;

-- The owner sees Wish and Want areas (and their effective times); never Locations.
drop view if exists public.geofences_geojson;
create view public.geofences_geojson
with (security_invoker = true) as
select
  f.id, f.reference, f.shape_type, f.center_lat, f.center_lng, f.radius_m,
  f.description, f.category, f.origin, f.verification_status, f.moderation_status,
  f.status, f.submitted_at, f.updated_at,
  st_asgeojson(f.geometry)::jsonb as geojson,
  coalesce(s.inside, false) as currently_inside,
  f.watcher_id, f.tier, f.wide_mode, f.effective_from
from public.geofences f
left join public.geofence_state s on s.geofence_id = f.id
where f.geometry is not null
  and (f.tier is null or f.tier in ('wide', 'local'));
revoke all on public.geofences_geojson from anon;

-- Want areas are checked by the database too (alerts for everyone who set them).
create or replace function public.geofence_signed_distances(p_lat double precision, p_lng double precision)
returns table (geofence_id uuid, reference text, signed_distance_m double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with pt as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g)
  select
    f.id,
    f.reference,
    (case when f.shape_type = 'beyond_home' or f.wide_mode = 'outside' then -1 else 1 end) *
    (case when st_covers(f.geometry, pt.g)
      then  st_distance(st_boundary(f.geometry::geometry)::geography, pt.g)
      else -st_distance(f.geometry, pt.g)
    end)
  from public.geofences f, pt
  where f.status = 'active'
    and f.geometry is not null
    and (f.tier is null or f.tier in ('wide', 'local'))
    and (f.shape_type = 'beyond_home' or f.wide_mode = 'outside' or st_dwithin(f.geometry, pt.g, 20000));
$$;

alter table public.geofence_versions enable row level security;
drop policy if exists geofence_versions_admin_read on public.geofence_versions;
create policy geofence_versions_admin_read on public.geofence_versions for select to authenticated
  using (public.is_admin() and (tier is null or tier in ('wide', 'local')));
revoke all on public.geofence_versions from anon;
revoke execute on function public.reveal_want_area(uuid, text, text, double precision, double precision, real, text) from public, anon, authenticated;
grant execute on function public.reveal_want_area(uuid, text, text, double precision, double precision, real, text) to service_role;
revoke execute on function public.geofence_signed_distances(double precision, double precision) from public, anon, authenticated;
grant execute on function public.geofence_signed_distances(double precision, double precision) to service_role;
