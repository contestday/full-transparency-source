-- 21 Nov 2026: events I'm banned from (owner decision).
-- I can add my own events: places and times I mustn't be. Unlike watchers'
-- events, mine are public: everyone sees them (like plans), and being inside
-- one while it's on shows red for everyone. They need no watch link and no
-- 48 hours' notice.

alter table public.watch_events alter column watcher_id drop not null;
alter table public.watch_events add column if not exists is_owner boolean not null default false;
alter table public.watch_events drop constraint if exists watch_events_owner_or_watcher;
alter table public.watch_events add constraint watch_events_owner_or_watcher check (is_owner or watcher_id is not null);

create or replace function public.watch_events_notice()
returns trigger
language plpgsql
as $$
begin
  if new.is_owner then
    return new; -- my own bans: any time
  end if;
  if new.starts_at < now() + interval '48 hours' then
    raise exception 'An event must be set at least 48 hours before it starts';
  end if;
  if new.starts_at > now() + interval '5 years 1 day' then
    raise exception 'An event can be set up to 5 years ahead';
  end if;
  return new;
end;
$$;
