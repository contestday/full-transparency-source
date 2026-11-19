-- Allow exact public positions (owner decision, 18 Nov 2026).
--
-- Until now a published record had to be either a grid square
-- (cell_size_m > 0) or a named public venue. The history is now published at
-- the recorded GPS position everywhere outside the exclusion zones, so
-- cell_size_m = 0 with no venue name is allowed. Exclusion zones are still
-- enforced by the publication code (src/lib/publication.ts).

alter table public.published_locations drop constraint if exists published_locations_cell_or_venue;
alter table public.published_locations
  add constraint published_locations_cell_size_check check (cell_size_m >= 0);
