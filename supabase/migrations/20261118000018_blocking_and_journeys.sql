-- Blocking abusive senders, and an anonymous journey log (18 Nov 2026). Apply after 0017.
--
-- Senders: every submission already carries a salted one-way hash of the
-- sender's IP address (submitter_hash). We now also keep the country Vercel
-- reports for the request (two letters, e.g. GB). The owner can block a
-- sender's hash, or accept submissions only from chosen countries
-- (system_state 'submission_rules'). Raw IP addresses are never stored.
--
-- Journeys: site_events holds anonymous steps through the public site: a
-- random per-visit ID (no cookie, new each visit), the page (private links
-- removed), button taps, and error messages shown. Kept for 30 days.

alter table public.geofences add column if not exists submitter_country text;
alter table public.watchers add column if not exists submitter_country text;
alter table public.incident_reports add column if not exists submitter_country text;

create table if not exists public.blocked_submitters (
  submitter_hash text primary key,
  reason text,
  country text,
  created_at timestamptz not null default now()
);

create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  visit_id text not null check (length(visit_id) between 8 and 40),
  at timestamptz not null,
  kind text not null check (kind in ('page', 'tap', 'error')),
  path text check (length(path) <= 300),
  detail text check (length(detail) <= 300),
  country text check (length(country) <= 2),
  created_at timestamptz not null default now()
);
create index if not exists site_events_at_idx on public.site_events (at desc);
create index if not exists site_events_visit_idx on public.site_events (visit_id, at);

alter table public.blocked_submitters enable row level security;
alter table public.site_events enable row level security;
drop policy if exists blocked_submitters_admin_all on public.blocked_submitters;
create policy blocked_submitters_admin_all on public.blocked_submitters for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists site_events_admin_read on public.site_events;
create policy site_events_admin_read on public.site_events for select to authenticated
  using (public.is_admin());
revoke all on public.blocked_submitters from anon;
revoke all on public.site_events from anon;
