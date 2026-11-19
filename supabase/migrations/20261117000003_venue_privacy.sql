-- Venue privacy (owner decision, 17 Nov 2026):
--   * Private addresses are hidden by default: only an area/road label and a
--     generalised cell are ever published.
--   * Public venues (pubs, hotels, restaurants, ...) are shown in full: name
--     and exact location, in plans and in published history.

set search_path = public, extensions;

alter table public.venues add column is_public boolean not null default false;

-- Published history can now carry a public venue (exact position, cell 0).
alter table public.published_locations add column venue_name text;
alter table public.published_locations
  add constraint published_locations_cell_or_venue
  check (cell_size_m > 0 or venue_name is not null);

create or replace view public.public_history as
select
  -- (new columns must come last for CREATE OR REPLACE VIEW)
  id, kind, public_lat, public_lng, cell_size_m, area_label, category,
  observed_at, observed_until, published_at, venue_name
from public.published_locations
where visibility_status = 'published';

grant select on public.public_history to anon, authenticated;

-- Plans: the venue name is shown only when the plan is published at venue
-- precision (the server refuses that mode for private venues unless confirmed).
create or replace view public.public_plans as
select
  p.id,
  p.title,
  p.category,
  case
    when p.publication_mode in ('exact_venue', 'retrospective') then v.name
    else null
  end as venue_name,
  p.description,
  p.starts_at,
  p.ends_at,
  p.all_day,
  p.status,
  p.publication_mode,
  p.public_area_label,
  p.public_lat,
  p.public_lng,
  p.public_cell_size_m,
  p.published_at,
  p.updated_at
from public.planned_activities p
left join public.venues v on v.id = p.venue_id
where p.archived = false
  and p.status <> 'draft'
  and p.publication_mode <> 'private'
  and p.published_at is not null
  and (
    p.publication_mode <> 'retrospective'
    or coalesce(p.ends_at, p.starts_at) < now()
  );

grant select on public.public_plans to anon, authenticated;
