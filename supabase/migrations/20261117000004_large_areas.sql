-- Allow large areas of concern (owner decision, 17 Nov 2026): searching a
-- place name such as "South Yorkshire" creates a circle centred on the middle of
-- the place, reaching its furthest point (~25 km). The old 25 km² cap is
-- raised to 8,000 km² (a circle of ~50 km radius).

set search_path = public, extensions;

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
  add constraint geofences_area_limit check (st_area(geometry) <= 8000000000);
