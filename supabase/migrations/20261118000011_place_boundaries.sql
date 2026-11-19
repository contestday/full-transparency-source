-- Watch areas can follow a named place's real boundary (18 Nov 2026).
--
-- Searching a town, county, island or country now uses its real outline from
-- OpenStreetMap (simplified to at most 2,000 points) instead of a circle. An
-- outline may have several parts (islands), so the geometry column accepts
-- MultiPolygon as well as Polygon, and the 8,000 km² cap is lifted: circles may
-- reach 1,000 km (areas must still be centred in the supported region,
-- checked by the server).

set search_path = public, extensions;

-- The admin listing view depends on the column; drop it while the type changes.
drop view if exists public.geofences_geojson;

alter table public.geofences
  alter column geometry type geography(Geometry, 4326) using geometry::geography;

-- Only polygons may be stored.
alter table public.geofences drop constraint if exists geofences_polygonal;
alter table public.geofences
  add constraint geofences_polygonal check (geometrytype(geometry::geometry) in ('POLYGON', 'MULTIPOLYGON'));

-- Lift the area cap: 5,000,000 km² (a 1,000 km radius circle is ~3.1 million).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.geofences'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%st_area%'
  loop
    execute format('alter table public.geofences drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.geofences
  add constraint geofences_area_limit check (st_area(geometry) <= 5000000000000);

-- Same view as 20261117000005.
create view public.geofences_geojson
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

-- Insert: accept Polygon or MultiPolygon; repair a simplified outline whose
-- edges touch (keeping only its polygon parts) instead of rejecting it.
create or replace function public.insert_geofence(
  p_reference text,
  p_geojson text,
  p_shape_type text,
  p_center_lat double precision,
  p_center_lng double precision,
  p_radius_m real,
  p_description text,
  p_category text,
  p_origin text,
  p_withdrawal_code_hash text,
  p_submitter_hash text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_geom geometry := st_setsrid(st_geomfromgeojson(p_geojson), 4326);
  v_id uuid;
begin
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
  insert into public.geofences (
    reference, geometry, shape_type, center_lat, center_lng, radius_m,
    description, category, origin, withdrawal_code_hash, submitter_hash
  ) values (
    p_reference, v_geom::geography, p_shape_type, p_center_lat, p_center_lng, p_radius_m,
    p_description, p_category, p_origin, p_withdrawal_code_hash, p_submitter_hash
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Signed distance to the boundary: st_boundary works for multi-part outlines
-- (st_exteriorring only handles a single polygon).
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
    case when st_covers(f.geometry, pt.g)
      then  st_distance(st_boundary(f.geometry::geometry)::geography, pt.g)
      else -st_distance(f.geometry, pt.g)
    end
  from public.geofences f, pt
  where f.status = 'active'
    and st_dwithin(f.geometry, pt.g, 20000);
$$;

revoke execute on function public.insert_geofence(text, text, text, double precision, double precision, real, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.geofence_signed_distances(double precision, double precision) from public, anon, authenticated;
grant execute on function public.insert_geofence(text, text, text, double precision, double precision, real, text, text, text, text, text) to service_role;
grant execute on function public.geofence_signed_distances(double precision, double precision) to service_role;
