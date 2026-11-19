-- Defence in depth (18 Nov 2026): the admin listing view must never be
-- readable by anonymous visitors (it is security_invoker, so it already
-- returns nothing to them; this removes the grant as well).
revoke all on public.geofences_geojson from anon;
