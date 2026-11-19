-- "On the move" flag for the live marker, and a friendly random number for
-- each watch link (17 Nov 2026).

set search_path = public, extensions;

alter table public.live_status add column moving boolean not null default false;

-- Public view: same columns as before plus `moving` (new columns go last).
create or replace view public.public_live_status as
select
  case when r.enabled then s.public_status else 'disabled' end as status,
  case when r.enabled then s.public_lat end as public_lat,
  case when r.enabled then s.public_lng end as public_lng,
  case when r.enabled then s.cell_size_m end as cell_size_m,
  case when r.enabled then s.observed_at end as observed_at,
  case when r.enabled then s.status_since end as status_since,
  case when r.enabled then s.updated_at end as updated_at,
  case when r.enabled then s.moving else false end as moving
from public.live_status s
cross join lateral (
  select coalesce(
    (select enabled from public.publication_rules where rule_type = 'live_status' order by updated_at desc limit 1),
    false
  ) as enabled
) r
where s.id = 1;
grant select on public.public_live_status to anon, authenticated;

-- A random, non-sequential 4-digit number shown to each watcher (e.g. "Watcher
-- #4827"). It is only a friendly label, never a way to sign in: the secret
-- token remains the key.
alter table public.watchers add column display_code text unique;

do $$
declare w record; code text;
begin
  for w in select id from public.watchers where display_code is null loop
    loop
      code := lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
      exit when not exists (select 1 from public.watchers where display_code = code);
    end loop;
    update public.watchers set display_code = code where id = w.id;
  end loop;
end $$;
