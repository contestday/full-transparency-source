-- Data fix (17 Nov 2026): route samples ("track" records) were published with
-- their time rounded down to 15 minutes, so 3-minute samples shared timestamps
-- and could not be drawn in order. Each record's exact sample time is encoded
-- in its source_key ("track:<epoch milliseconds>"); restore it.

update public.published_locations
set observed_at = to_timestamp(split_part(source_key, ':', 2)::bigint / 1000.0)
where kind = 'track'
  and source_key ~ '^track:[0-9]+$';

create index if not exists published_locations_kind_observed_idx
  on public.published_locations (kind, observed_at);
