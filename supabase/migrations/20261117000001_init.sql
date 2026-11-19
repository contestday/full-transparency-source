-- Full Transparency — initial schema
-- Requires: PostGIS (enabled below), pgcrypto (Supabase default).
--
-- Security model
--   * RLS is enabled on EVERY table.
--   * Private tables have policies only for the 'admin' role (and, where relevant,
--     the 'reviewer' role). anon/authenticated without a role get nothing.
--   * Public data is exposed ONLY through the views public_history and public_plans,
--     which project already-generalised columns. Server code reads those views with
--     the service role; anon is granted SELECT on the views only.
--   * Anonymous submissions (geofences, reports) are inserted server-side with the
--     service role after validation and rate limiting. anon has no INSERT grants.

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Roles / profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'none' check (role in ('none', 'reviewer', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'none');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select public.current_role_name() = 'admin'; $$;

create or replace function public.is_reviewer_or_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select public.current_role_name() in ('admin', 'reviewer'); $$;

-- Every new auth user gets a profile with NO access. An admin must be promoted
-- manually (see docs/DEPLOYMENT.md).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Location data (PRIVATE)
-- ---------------------------------------------------------------------------
create table public.location_import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('followmee', 'google_timeline', 'manual', 'ingest_api')),
  file_name text,
  file_hash text,
  detected_format text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  rejected_count integer not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index location_import_batches_created_idx on public.location_import_batches (created_at desc);
create index location_import_batches_hash_idx on public.location_import_batches (file_hash);

create table public.location_observations (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('followmee', 'google_timeline', 'manual', 'ingest_api')),
  source_record_id text not null,
  device_id text,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  position geography(Point, 4326)
    generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  import_batch_id uuid references public.location_import_batches (id) on delete set null,
  validation_status text not null default 'valid'
    check (validation_status in ('valid', 'suspect', 'rejected')),
  metadata jsonb not null default '{}'::jsonb,
  unique (source, source_record_id)
);
create index location_observations_observed_idx on public.location_observations (observed_at desc);
create index location_observations_batch_idx on public.location_observations (import_batch_id);
create index location_observations_position_gix on public.location_observations using gist (position);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  address text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  position geography(Point, 4326)
    generated always as (
      case when lat is null or lng is null then null
      else st_setsrid(st_makepoint(lng, lat), 4326)::geography end
    ) stored,
  public_area_label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index venues_position_gix on public.venues using gist (position);
create index venues_name_idx on public.venues (lower(name));

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  location geography(Point, 4326)
    generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  radius_m real,
  category text,
  venue_id uuid references public.venues (id) on delete set null,
  source text not null,
  observation_count integer not null default 0,
  confidence real not null default 0.5 check (confidence between 0 and 1),
  planned_activity_id uuid,
  created_at timestamptz not null default now(),
  unique (source, started_at)
);
create index visits_started_idx on public.visits (started_at desc);
create index visits_location_gix on public.visits using gist (location);

-- ---------------------------------------------------------------------------
-- Publication (PUBLIC-FACING DERIVED DATA)
-- ---------------------------------------------------------------------------
create table public.publication_rules (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null check (rule_type in (
    'delay',              -- {"hours": 24}
    'grid',               -- {"meters": 1000}
    'exclusion_zone',     -- {"lat":..,"lng":..,"radius_m":..,"label":"Home"}
    'excluded_category',  -- {"category": "healthcare"}
    'area_label',         -- {"lat":..,"lng":..,"radius_m":..,"label":"Central Leeds"}
    'pause',              -- {}  (enabled = paused)
    'publish_tracks'      -- {"interval_minutes": 60}
  )),
  configuration jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.publication_rules (rule_type, configuration, enabled) values
  ('delay', '{"hours": 24}', true),
  ('grid', '{"meters": 1000}', true),
  ('pause', '{}', true),            -- publication starts PAUSED until configured
  ('publish_tracks', '{"interval_minutes": 60}', false),
  ('excluded_category', '{"category": "healthcare"}', true);

create table public.published_locations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'visit' check (kind in ('visit', 'track')),
  source_visit_id uuid references public.visits (id) on delete set null,
  source_key text not null unique,     -- dedupe key for idempotent publication
  public_lat double precision not null,
  public_lng double precision not null,
  public_position geography(Point, 4326)
    generated always as (st_setsrid(st_makepoint(public_lng, public_lat), 4326)::geography) stored,
  cell_size_m integer not null,
  area_label text,
  category text,
  observed_at timestamptz not null,
  observed_until timestamptz,
  published_at timestamptz not null default now(),
  visibility_status text not null default 'published'
    check (visibility_status in ('published', 'withdrawn')),
  withdrawn_at timestamptz,
  withdrawn_reason text
);
create index published_locations_observed_idx on public.published_locations (observed_at desc);
create index published_locations_position_gix on public.published_locations using gist (public_position);

-- ---------------------------------------------------------------------------
-- Plans Board
-- ---------------------------------------------------------------------------
create table public.planned_activities (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  category text not null,
  venue_id uuid references public.venues (id) on delete set null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default true,
  -- Optional free-standing location (when no venue)
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  status text not null default 'draft'
    check (status in ('draft', 'planned', 'confirmed', 'changed', 'cancelled', 'completed')),
  publication_mode text not null default 'private'
    check (publication_mode in ('private', 'general_area', 'exact_venue', 'retrospective')),
  public_area_label text,
  -- Generalised coordinates computed server-side at publication time
  public_lat double precision,
  public_lng double precision,
  public_cell_size_m integer,
  archived boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index planned_activities_starts_idx on public.planned_activities (starts_at);

alter table public.visits
  add constraint visits_planned_activity_fk
  foreign key (planned_activity_id) references public.planned_activities (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Geofences (PRIVATE; anonymous submissions inserted by server)
-- ---------------------------------------------------------------------------
create table public.geofences (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  geometry geography(Polygon, 4326) not null,
  shape_type text not null check (shape_type in ('circle', 'polygon')),
  center_lat double precision,
  center_lng double precision,
  radius_m real,
  description text,
  category text,
  origin text not null default 'anonymous' check (origin in ('anonymous', 'admin')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'disputed')),
  moderation_status text not null default 'private'
    check (moderation_status in ('private', 'pending_public', 'approved_public', 'rejected')),
  status text not null default 'active' check (status in ('active', 'withdrawn', 'archived')),
  withdrawal_code_hash text,
  submitter_hash text,           -- salted hash of client IP, for abuse limits only
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (st_area(geometry) <= 25000000)   -- 25 km²
);
create index geofences_geometry_gix on public.geofences using gist (geometry);
create index geofences_submitted_idx on public.geofences (submitted_at desc);

create table public.geofence_state (
  geofence_id uuid primary key references public.geofences (id) on delete cascade,
  inside boolean not null default false,
  pending_inside boolean,
  pending_count integer not null default 0,
  last_observed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.geofence_events (
  id uuid primary key default gen_random_uuid(),
  geofence_id uuid not null references public.geofences (id) on delete cascade,
  event_type text not null check (event_type in ('enter', 'exit', 'submitted', 'changed', 'withdrawn')),
  observed_at timestamptz not null,
  location_observation_id uuid references public.location_observations (id) on delete set null,
  accuracy_m real,
  created_at timestamptz not null default now()
);
create index geofence_events_geofence_idx on public.geofence_events (geofence_id, observed_at desc);

-- Verified legal restrictions are a DISTINCT workflow from anonymous concerns.
create table public.legal_restrictions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  issuing_authority text not null,
  authority_reference text,
  description text,
  geometry geography(Polygon, 4326),
  valid_from date,
  valid_until date,
  verified_at timestamptz,
  verified_by uuid references auth.users (id),
  verification_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  channel text not null check (channel in ('web_push', 'email')),
  endpoint text not null,
  keys jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (channel, endpoint)
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.notification_subscriptions (id) on delete set null,
  event_type text not null,
  title text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz not null default now()
);
create index notification_deliveries_created_idx on public.notification_deliveries (created_at desc);

-- ---------------------------------------------------------------------------
-- Confidential reporting
-- ---------------------------------------------------------------------------
create table public.incident_reports (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  category text not null,
  description text not null,
  incident_at timestamptz,
  incident_time_approximate boolean not null default true,
  general_location text,
  contact_info text,
  related_geofence_reference text,
  status text not null default 'new'
    check (status in ('new', 'under_review', 'awaiting_information', 'closed', 'flagged_abuse')),
  submitter_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incident_reports_created_idx on public.incident_reports (created_at desc);
create index incident_reports_status_idx on public.incident_reports (status);

create table public.report_attachments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.incident_reports (id) on delete cascade,
  storage_path text not null,
  mime_type text not null,
  size_bytes integer,
  created_at timestamptz not null default now()
);

create table public.report_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.incident_reports (id) on delete cascade,
  author_id uuid references auth.users (id),
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit, rate limiting, system state
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id),
  actor_label text,             -- 'system', 'anonymous', etc. when no user
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on public.audit_events (created_at desc);
create index audit_events_resource_idx on public.audit_events (resource_type, resource_id);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

create table public.system_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Atomic fixed-window rate limiter. Returns true when the request is ALLOWED.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  delete from public.rate_limits where window_start < now() - interval '2 days';
  return v_count <= p_max;
end;
$$;

-- ---------------------------------------------------------------------------
-- Spatial helper functions (called by the server with the service role)
-- ---------------------------------------------------------------------------

-- Insert a geofence from a GeoJSON polygon string.
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
  if not st_isvalid(v_geom) then
    raise exception 'invalid geometry';
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

-- Signed distance (metres) from a point to each active geofence boundary.
-- Positive = inside, negative = outside.
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
      then  st_distance(st_exteriorring(f.geometry::geometry)::geography, pt.g)
      else -st_distance(f.geometry, pt.g)
    end
  from public.geofences f, pt
  where f.status = 'active'
    and st_dwithin(f.geometry, pt.g, 20000);
$$;

-- Admin-facing geofence listing with GeoJSON geometry.
create or replace view public.geofences_geojson
with (security_invoker = true) as
select
  f.id, f.reference, f.shape_type, f.center_lat, f.center_lng, f.radius_m,
  f.description, f.category, f.origin, f.verification_status, f.moderation_status,
  f.status, f.submitted_at, f.updated_at,
  st_asgeojson(f.geometry)::jsonb as geojson,
  coalesce(s.inside, false) as currently_inside
from public.geofences f
left join public.geofence_state s on s.geofence_id = f.id;

-- ---------------------------------------------------------------------------
-- PUBLIC VIEWS — the only objects the public site reads
-- ---------------------------------------------------------------------------
create or replace view public.public_history as
select
  id, kind, public_lat, public_lng, cell_size_m, area_label, category,
  observed_at, observed_until, published_at
from public.published_locations
where visibility_status = 'published';

create or replace view public.public_plans as
select
  p.id,
  p.title,
  p.category,
  -- Venue name only for exact_venue mode, or for retrospective once in the past
  case
    when p.publication_mode = 'exact_venue' then v.name
    when p.publication_mode = 'retrospective' then v.name
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

create or replace view public.public_status as
select
  coalesce(
    (select enabled from public.publication_rules where rule_type = 'pause' order by updated_at desc limit 1),
    true
  ) as publication_paused,
  (select max(published_at) from public.published_locations where visibility_status = 'published')
    as last_published_at;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.location_import_batches enable row level security;
alter table public.location_observations enable row level security;
alter table public.venues enable row level security;
alter table public.visits enable row level security;
alter table public.publication_rules enable row level security;
alter table public.published_locations enable row level security;
alter table public.planned_activities enable row level security;
alter table public.geofences enable row level security;
alter table public.geofence_state enable row level security;
alter table public.geofence_events enable row level security;
alter table public.legal_restrictions enable row level security;
alter table public.notification_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.incident_reports enable row level security;
alter table public.report_attachments enable row level security;
alter table public.report_notes enable row level security;
alter table public.audit_events enable row level security;
alter table public.rate_limits enable row level security;
alter table public.system_state enable row level security;

-- profiles: users can read their own; admins manage all
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Admin-only tables: full access for admins
do $$
declare t text;
begin
  foreach t in array array[
    'location_import_batches', 'location_observations', 'venues', 'visits',
    'publication_rules', 'published_locations', 'planned_activities',
    'geofence_state', 'geofence_events', 'legal_restrictions',
    'notification_deliveries', 'system_state'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t
    );
  end loop;
end $$;

-- Notification subscriptions: admin manages own subscriptions
create policy notification_subscriptions_owner on public.notification_subscriptions for all to authenticated
  using (public.is_admin() and owner_id = auth.uid())
  with check (public.is_admin() and owner_id = auth.uid());

-- Geofences: admins full; reviewers read
create policy geofences_admin_all on public.geofences for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy geofences_reviewer_read on public.geofences for select to authenticated
  using (public.is_reviewer_or_admin());

-- Reports: admins and reviewers read/update; notes insert by reviewers; no delete by reviewers
create policy incident_reports_staff_read on public.incident_reports for select to authenticated
  using (public.is_reviewer_or_admin());
create policy incident_reports_staff_update on public.incident_reports for update to authenticated
  using (public.is_reviewer_or_admin()) with check (public.is_reviewer_or_admin());
create policy incident_reports_admin_delete on public.incident_reports for delete to authenticated
  using (public.is_admin());

create policy report_attachments_staff_read on public.report_attachments for select to authenticated
  using (public.is_reviewer_or_admin());

create policy report_notes_staff_read on public.report_notes for select to authenticated
  using (public.is_reviewer_or_admin());
create policy report_notes_staff_insert on public.report_notes for insert to authenticated
  with check (public.is_reviewer_or_admin() and author_id = auth.uid());

-- Audit: admins read; staff may insert their own events. Never update/delete.
create policy audit_events_admin_read on public.audit_events for select to authenticated
  using (public.is_admin());
create policy audit_events_staff_insert on public.audit_events for insert to authenticated
  with check (public.is_reviewer_or_admin() and actor_id = auth.uid());

-- rate_limits: no policies (service role / security definer only)

-- ---------------------------------------------------------------------------
-- Grants: lock down anon; expose only public views
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
-- Functions are executable by PUBLIC by default; the server-only helpers must be
-- revoked from PUBLIC as well as the Supabase API roles.
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.insert_geofence(text, text, text, double precision, double precision, real, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.geofence_signed_distances(double precision, double precision) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.insert_geofence(text, text, text, double precision, double precision, real, text, text, text, text, text) to service_role;
grant execute on function public.geofence_signed_distances(double precision, double precision) to service_role;

grant select on public.public_history to anon, authenticated;
grant select on public.public_plans to anon, authenticated;
grant select on public.public_status to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket for report attachments (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-attachments', 'report-attachments', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy report_attachments_staff_download on storage.objects for select to authenticated
  using (bucket_id = 'report-attachments' and public.is_reviewer_or_admin());
