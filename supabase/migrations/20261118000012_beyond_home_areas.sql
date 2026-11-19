-- "Anywhere beyond home" watch areas (18 Nov 2026). Apply after 0011.
--
-- A watcher can choose "anywhere more than X from home" instead of drawing a
-- shape. It is stored as the circle around home (shape_type 'beyond_home') and
-- evaluated inverted: being OUTSIDE the circle means being IN the area. The
-- circle itself is never shown to the watcher (it would reveal home).
--
-- Nesting (purple): a watcher's ordinary area that lies wholly beyond the home
-- circle sits inside their beyond-home area, so being in it shows purple.

set search_path = public, extensions;

-- Allow the new shape type.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.geofences'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%shape_type%'
  loop
    execute format('alter table public.geofences drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.geofences
  add constraint geofences_shape_type_check check (shape_type in ('circle', 'polygon', 'beyond_home'));

-- Signed distance: positive = in the area. Beyond-home areas are inverted and
-- always evaluated (they cover everywhere except around home).
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
    (case when f.shape_type = 'beyond_home' then -1 else 1 end) *
    (case when st_covers(f.geometry, pt.g)
      then  st_distance(st_boundary(f.geometry::geometry)::geography, pt.g)
      else -st_distance(f.geometry, pt.g)
    end)
  from public.geofences f, pt
  where f.status = 'active'
    and (f.shape_type = 'beyond_home' or st_dwithin(f.geometry, pt.g, 20000));
$$;

-- Which active areas lie inside which (for purple).
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
   and i.shape_type <> 'beyond_home'
   and (
     (o.shape_type <> 'beyond_home' and st_coveredby(i.geometry::geometry, o.geometry::geometry))
     or (o.shape_type = 'beyond_home' and not st_intersects(i.geometry, o.geometry))
   )
  where i.status = 'active';
$$;

revoke execute on function public.geofence_signed_distances(double precision, double precision) from public, anon, authenticated;
revoke execute on function public.geofence_nesting() from public, anon, authenticated;
grant execute on function public.geofence_signed_distances(double precision, double precision) to service_role;
grant execute on function public.geofence_nesting() to service_role;
