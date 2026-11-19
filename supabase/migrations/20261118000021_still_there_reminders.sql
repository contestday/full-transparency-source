-- "Still there" reminders (18 Nov 2026). Apply after 0020.
-- While I'm inside a watcher's Want (red) or Location (purple) area, that
-- watcher is reminded at the interval they choose (10, 20, 30 or 60 minutes;
-- 0 = off). Default: every 30 minutes.

alter table public.watchers add column if not exists reminder_minutes integer not null default 30;
alter table public.watchers drop constraint if exists watchers_reminder_minutes_check;
alter table public.watchers
  add constraint watchers_reminder_minutes_check check (reminder_minutes in (0, 10, 20, 30, 60));

alter table public.geofence_state add column if not exists last_reminded_at timestamptz;
