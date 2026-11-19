-- Watch area tiers, sealed areas and the yellow state (18 Nov 2026). Apply after 0014.
--
-- Watchers now choose one of three kinds of area:
--   wide     (amber)  a large area I should not go into, or not go outside of.
--                     Stored as plain geometry: the owner can see these.
--   local    (red)    a smaller area. SEALED: encrypted with a key derived from
--                     the watcher's private link, so it is not readable here.
--   location (purple) a place such as a home or workplace, blurred to an
--                     off-centre circle. SEALED like local areas.
-- A sealed row has geometry = null and its shape, name and note in `sealed`.
-- If the watcher turns on alerts for red/purple, `watchers.alert_key` holds
-- their key encrypted with a server secret so the alert job can check them.
--
-- The owner's "outside my okay zone" colour is now yellow (deep yellow);
-- amber is reserved for watchers' wide areas.

set search_path = public, extensions;

alter table public.geofences
  add column if not exists tier text check (tier in ('wide', 'local', 'location')),
  add column if not exists wide_mode text check (wide_mode in ('inside', 'outside')),
  add column if not exists sealed text;

alter table public.geofences alter column geometry drop not null;
alter table public.geofences drop constraint if exists geofences_geometry_or_sealed;
alter table public.geofences
  add constraint geofences_geometry_or_sealed check (geometry is not null or sealed is not null);

-- 'boundary' = a named place's real outline (so editing keeps its size rule).
alter table public.geofences drop constraint if exists geofences_shape_type_check;
alter table public.geofences
  add constraint geofences_shape_type_check check (shape_type in ('circle', 'polygon', 'boundary', 'beyond_home'));

alter table public.watchers add column if not exists alert_key text;

-- Existing watcher areas: "beyond home" is a wide area (don't go outside);
-- an area lying inside another of the same watcher's areas is local; the rest
-- are wide. Local ones are sealed the next time their watcher opens the page.
update public.geofences set tier = 'wide', wide_mode = 'outside'
where watcher_id is not null and tier is null and shape_type = 'beyond_home';

update public.geofences i set tier = 'local'
where i.watcher_id is not null and i.tier is null and i.status = 'active'
  and exists (
    select 1 from public.geofences o
    where o.watcher_id = i.watcher_id and o.id <> i.id and o.status = 'active'
      and o.geometry is not null and i.geometry is not null
      and (
        (o.shape_type <> 'beyond_home' and st_coveredby(i.geometry::geometry, o.geometry::geometry))
        or (o.shape_type = 'beyond_home' and not st_intersects(i.geometry, o.geometry))
      )
  );

update public.geofences set tier = 'wide', wide_mode = 'inside'
where watcher_id is not null and tier is null;

-- Admin listing: wide areas and the owner's own areas only. Watchers' local
-- areas and locations never appear here.
drop view if exists public.geofences_geojson;
create view public.geofences_geojson
with (security_invoker = true) as
select
  f.id, f.reference, f.shape_type, f.center_lat, f.center_lng, f.radius_m,
  f.description, f.category, f.origin, f.verification_status, f.moderation_status,
  f.status, f.submitted_at, f.updated_at,
  st_asgeojson(f.geometry)::jsonb as geojson,
  coalesce(s.inside, false) as currently_inside,
  f.watcher_id, f.tier, f.wide_mode
from public.geofences f
left join public.geofence_state s on s.geofence_id = f.id
where f.geometry is not null
  and (f.tier is null or f.tier = 'wide');

-- Server-only: legacy (not yet sealed) local areas, so they can be sealed.
create or replace function public.unsealed_watch_areas(p_watcher_id uuid)
returns table (id uuid, reference text, tier text, shape_type text, center_lat double precision, center_lng double precision, radius_m real, description text, geojson jsonb)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select f.id, f.reference, f.tier, f.shape_type, f.center_lat, f.center_lng, f.radius_m, f.description, st_asgeojson(f.geometry)::jsonb
  from public.geofences f
  where f.watcher_id = p_watcher_id and f.status = 'active'
    and f.tier in ('local', 'location') and f.sealed is null and f.geometry is not null;
$$;

-- Create or replace a watcher's area. Plain (wide) areas pass p_geojson;
-- sealed ones pass p_sealed and no geometry.
create or replace function public.save_watch_area(
  p_id uuid,
  p_reference text,
  p_watcher_id uuid,
  p_tier text,
  p_wide_mode text,
  p_geojson text,
  p_shape_type text,
  p_center_lat double precision,
  p_center_lng double precision,
  p_radius_m real,
  p_description text,
  p_sealed text,
  p_withdrawal_code_hash text,
  p_submitter_hash text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_geom geometry;
  v_id uuid;
begin
  if p_geojson is not null then
    v_geom := st_setsrid(st_geomfromgeojson(p_geojson), 4326);
    if geometrytype(v_geom) not in ('POLYGON', 'MULTIPOLYGON') then
      raise exception 'invalid geometry';
    end if;
    if not st_isvalid(v_geom) then
      v_geom := st_collectionextract(st_makevalid(v_geom), 3);
      if st_isempty(v_geom) then
        raise exception 'invalid geometry';
      end if;
    end if;
    if st_numgeometries(v_geom) = 1 then
      v_geom := st_geometryn(v_geom, 1);
    end if;
  elsif p_sealed is null then
    raise exception 'invalid geometry';
  end if;

  if p_id is null then
    insert into public.geofences (
      reference, geometry, shape_type, center_lat, center_lng, radius_m, description,
      origin, withdrawal_code_hash, submitter_hash, watcher_id, tier, wide_mode, sealed
    ) values (
      p_reference, v_geom::geography, p_shape_type, p_center_lat, p_center_lng, p_radius_m, p_description,
      'anonymous', p_withdrawal_code_hash, p_submitter_hash, p_watcher_id, p_tier, p_wide_mode, p_sealed
    ) returning id into v_id;
  else
    update public.geofences set
      geometry = v_geom::geography,
      shape_type = p_shape_type,
      center_lat = p_center_lat,
      center_lng = p_center_lng,
      radius_m = p_radius_m,
      description = p_description,
      tier = p_tier,
      wide_mode = p_wide_mode,
      sealed = p_sealed,
      updated_at = now()
    where id = p_id and watcher_id = p_watcher_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Signed distance: positive = in the area. "Don't go outside" areas (and the
-- older beyond-home ones) are inverted and always evaluated. Sealed areas have
-- no geometry here; the app checks them itself.
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
    and (f.tier is null or f.tier = 'wide') -- local areas waiting to be sealed are private already
    and (f.shape_type = 'beyond_home' or f.wide_mode = 'outside' or st_dwithin(f.geometry, pt.g, 20000));
$$;

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
   and o.geometry is not null
   and i.shape_type <> 'beyond_home'
   and (
     (o.shape_type <> 'beyond_home' and st_coveredby(i.geometry::geometry, o.geometry::geometry))
     or (o.shape_type = 'beyond_home' and not st_intersects(i.geometry, o.geometry))
   )
  where i.status = 'active' and i.geometry is not null;
$$;

-- Yellow: outside the owner's okay zone (was amber).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.live_status'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%status%')
  loop
    execute format('alter table public.live_status drop constraint %I', c.conname);
  end loop;
end $$;
update public.live_status set public_status = 'yellow' where public_status = 'amber';
update public.live_status set status = 'yellow' where status = 'amber';
alter table public.live_status
  add constraint live_status_status_check check (status in ('green', 'yellow', 'amber', 'red', 'purple', 'unknown')),
  -- 'amber' stays allowed so the previous app version keeps working until the new one is live.
  add constraint live_status_public_status_check check (public_status in ('green', 'yellow', 'amber', 'unknown'));

revoke execute on function public.unsealed_watch_areas(uuid) from public, anon, authenticated;
revoke execute on function public.save_watch_area(uuid, text, uuid, text, text, text, text, double precision, double precision, real, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.geofence_signed_distances(double precision, double precision) from public, anon, authenticated;
revoke execute on function public.geofence_nesting() from public, anon, authenticated;
grant execute on function public.unsealed_watch_areas(uuid) to service_role;
grant execute on function public.save_watch_area(uuid, text, uuid, text, text, text, text, double precision, double precision, real, text, text, text, text) to service_role;
grant execute on function public.geofence_signed_distances(double precision, double precision) to service_role;
grant execute on function public.geofence_nesting() to service_role;
