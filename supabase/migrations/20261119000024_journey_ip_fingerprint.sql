-- Journeys get the same anonymous IP fingerprint senders already have
-- (19 Nov 2026). Apply after 0023.
--
-- ip_hash is the salted one-way hash used for rate limiting and senders
-- (never the raw IP). owner_device marks visits from a device that has opened
-- the admin area. Every visit is still recorded; both only let the Journeys
-- report hide the owner's own visits (ignored fingerprints live in
-- system_state 'ignored_ips').

alter table public.site_events add column if not exists ip_hash text;
alter table public.site_events add column if not exists owner_device boolean not null default false;
-- automated: "vercel", "test browser" or "bot" (from the browser's user agent),
-- null for a person. Recorded, hidden on the Journeys report.
alter table public.site_events add column if not exists automated text;
create index if not exists site_events_ip_hash_idx on public.site_events (ip_hash);
