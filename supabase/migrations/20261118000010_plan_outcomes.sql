-- Plan outcomes (18 Nov 2026).
--
-- When a plan's time has passed, the publication job checks the GPS record:
-- if I was recorded at (one of) its locations, the plan becomes "completed"
-- with completion_source 'gps'. If not, I'm asked (push notification, once:
-- outcome_asked_at) to confirm it happened ('owner') or cancel it.
-- actual_started_at / actual_ended_at record when it really happened: from the
-- GPS record, or the times I enter when confirming.

alter table public.planned_activities
  add column if not exists completion_source text check (completion_source in ('gps', 'owner')),
  add column if not exists outcome_asked_at timestamptz,
  add column if not exists actual_started_at timestamptz,
  add column if not exists actual_ended_at timestamptz,
  add constraint planned_activities_actual_order check (actual_ended_at is null or actual_started_at is null or actual_ended_at >= actual_started_at);

-- Same view as 20261117000003, with the outcome columns added at the end.
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
  p.updated_at,
  p.completion_source,
  p.actual_started_at,
  p.actual_ended_at
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
