-- 21 Nov 2026
-- 1. Private venues: a venue whose name and position are never shown publicly.
--    Plans there show only "Private location". This protects the people who
--    live or work there; the visit itself is still listed.
-- 2. Permission / objection: anyone can say they give permission for a plan,
--    or object to it, with an optional reason. These are wishes, not orders.
--    Only the owner sees them (counts and reasons); nothing about them is public.

alter table public.venues add column if not exists is_hidden boolean not null default false;

-- Same view as 20261118000010, with private venues never named, and a flag at the end.
create or replace view public.public_plans as
select
  p.id,
  p.title,
  p.category,
  case
    when coalesce(v.is_hidden, false) then null
    when p.publication_mode in ('exact_venue', 'retrospective') then v.name
    else null
  end as venue_name,
  p.description,
  p.starts_at,
  p.ends_at,
  p.all_day,
  p.status,
  p.publication_mode,
  case when coalesce(v.is_hidden, false) then null else p.public_area_label end as public_area_label,
  case when coalesce(v.is_hidden, false) then null else p.public_lat end as public_lat,
  case when coalesce(v.is_hidden, false) then null else p.public_lng end as public_lng,
  case when coalesce(v.is_hidden, false) then null else p.public_cell_size_m end as public_cell_size_m,
  p.published_at,
  p.updated_at,
  p.completion_source,
  p.actual_started_at,
  p.actual_ended_at,
  coalesce(v.is_hidden, false) as private_location
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

create or replace view public.public_plan_locations as
select
  l.plan_id,
  l.position,
  case when coalesce(v.is_hidden, false) then null else l.public_venue_name end as venue_name,
  case when coalesce(v.is_hidden, false) then null else l.public_area_label end as area_label,
  case when coalesce(v.is_hidden, false) then null else l.public_lat end as public_lat,
  case when coalesce(v.is_hidden, false) then null else l.public_lng end as public_lng,
  case when coalesce(v.is_hidden, false) then null else l.public_cell_size_m end as public_cell_size_m,
  coalesce(v.is_hidden, false) as private_location
from public.plan_locations l
join public.public_plans p on p.id = l.plan_id
left join public.venues v on v.id = l.venue_id;

grant select on public.public_plan_locations to anon, authenticated;

create table if not exists public.plan_wishes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planned_activities (id) on delete cascade,
  kind text not null check (kind in ('permission', 'objection')),
  reason text check (reason is null or char_length(reason) <= 1000),
  submitter_hash text not null,
  submitter_country text,
  created_at timestamptz not null default now()
);
create index if not exists plan_wishes_plan_idx on public.plan_wishes (plan_id, created_at desc);
alter table public.plan_wishes enable row level security;
drop policy if exists plan_wishes_admin on public.plan_wishes;
create policy plan_wishes_admin on public.plan_wishes for all
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.plan_wishes from anon;
