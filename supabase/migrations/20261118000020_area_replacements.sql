-- Redrawing a watch area makes a new area (18 Nov 2026). Apply after 0019.
--
-- Changing an area's shape, kind or direction no longer edits it in place:
-- the old area ends at that moment and a new area, with a new reference,
-- starts at the same moment. replaces_id / replaces_reference link the new
-- area to the one it replaced, so the record shows the chain, and nobody can
-- point to an old reference for a shape that was drawn later.

set search_path = public, extensions;

alter table public.geofences add column if not exists replaces_id uuid references public.geofences (id);
alter table public.geofence_versions add column if not exists replaces_reference text;

-- The record stays append-only; the one extra change allowed is filling in
-- which area a new area replaced (once, from empty).
create or replace function public.geofence_versions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'The area record cannot be deleted';
  end if;
  if old.replaces_reference is distinct from new.replaces_reference then
    if old.replaces_reference is not null then
      raise exception 'The area record can only be closed, not changed';
    end if;
    if new.effective_until is not distinct from old.effective_until
       and new.effective_from = old.effective_from and new.reference = old.reference
       and new.tier is not distinct from old.tier and new.wide_mode is not distinct from old.wide_mode
       and new.sealed is not distinct from old.sealed and new.description is not distinct from old.description
       and (new.geometry::geometry is not distinct from old.geometry::geometry) then
      return new;
    end if;
    raise exception 'The area record can only be closed, not changed';
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

-- Link a new area to the one it replaced (server only).
create or replace function public.link_replacement(p_new uuid, p_old uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_ref text;
begin
  select reference into v_ref from public.geofences where id = p_old;
  update public.geofences set replaces_id = p_old where id = p_new and replaces_id is null;
  update public.geofence_versions set replaces_reference = v_ref
   where geofence_id = p_new and effective_until is null and replaces_reference is null;
end;
$$;
revoke execute on function public.link_replacement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_replacement(uuid, uuid) to service_role;

-- Redraw: the new area and the end of the old one happen in one step, so
-- the old one ends at exactly the moment the new one starts.
create or replace function public.replace_watch_area(
  p_old_id uuid,
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
  p_submitter_hash text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_new uuid;
begin
  if not exists (select 1 from public.geofences where id = p_old_id and watcher_id = p_watcher_id and status = 'active') then
    raise exception 'area not found';
  end if;
  update public.geofences set status = 'withdrawn', updated_at = now() where id = p_old_id;
  delete from public.geofence_state where geofence_id = p_old_id;
  v_new := public.save_watch_area(null, p_reference, p_watcher_id, p_tier, p_wide_mode, p_geojson, p_shape_type,
    p_center_lat, p_center_lng, p_radius_m, p_description, p_sealed, null, p_submitter_hash);
  perform public.link_replacement(v_new, p_old_id);
  return v_new;
end;
$$;

-- Rename only (same shape): no new effective time; the record keeps the latest name.
create or replace function public.rename_watch_area(p_id uuid, p_watcher_id uuid, p_description text, p_sealed text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform set_config('ft.reveal', '1', true);
  update public.geofences
     set description = p_description, sealed = coalesce(p_sealed, sealed), updated_at = now()
   where id = p_id and watcher_id = p_watcher_id and status = 'active';
  perform set_config('ft.reveal', '0', true);
end;
$$;

revoke execute on function public.replace_watch_area(uuid, text, uuid, text, text, text, text, double precision, double precision, real, text, text, text) from public, anon, authenticated;
grant execute on function public.replace_watch_area(uuid, text, uuid, text, text, text, text, double precision, double precision, real, text, text, text) to service_role;
revoke execute on function public.rename_watch_area(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.rename_watch_area(uuid, uuid, text, text) to service_role;
