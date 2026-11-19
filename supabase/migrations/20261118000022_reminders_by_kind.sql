-- Separate "still there" intervals for Want (red) and Location (purple) areas
-- (18 Nov 2026). Apply after 0021. reminder_minutes is for Want areas;
-- reminder_location_minutes for Locations. The public sample: red hourly,
-- purple every 20 minutes (owner's choice).

alter table public.watchers add column if not exists reminder_location_minutes integer not null default 30;
alter table public.watchers drop constraint if exists watchers_reminder_location_minutes_check;
alter table public.watchers
  add constraint watchers_reminder_location_minutes_check check (reminder_location_minutes in (0, 10, 20, 30, 60));
update public.watchers w set reminder_minutes = 60, reminder_location_minutes = 20
from public.system_state s where s.key = 'sample_watcher' and (s.value->>'watcherId')::uuid = w.id;
