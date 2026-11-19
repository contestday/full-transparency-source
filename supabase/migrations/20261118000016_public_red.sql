-- Red for everyone (18 Nov 2026): being inside one of the owner's own (admin)
-- areas shows red publicly, as an out-of-bounds area. Apply after 0015.
alter table public.live_status drop constraint if exists live_status_public_status_check;
alter table public.live_status
  add constraint live_status_public_status_check check (public_status in ('green', 'yellow', 'amber', 'red', 'unknown'));
