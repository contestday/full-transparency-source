-- Each watcher chooses whether police reporting is on for their own watch link
-- (off by default). It only works while the owner's master switch is also on.
alter table public.watchers add column if not exists police_reports boolean not null default false;
alter table public.watchers add column if not exists police_reports_at timestamptz;
