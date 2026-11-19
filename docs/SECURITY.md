# Security and privacy

## Data isolation model

| Data | Who can read | Mechanism |
|---|---|---|
| Raw GPS observations, visits, import batches | Admin | RLS `is_admin()`; server pages use the user's session client |
| Geofences | Admin (full), reviewer (read) | RLS |
| Geofence entry/exit events and state | Admin | RLS |
| Reports, notes, attachments | Admin + reviewer | RLS; attachments in a **private** bucket, served by 5-minute signed URLs |
| Audit log | Admin (read); staff insert own | RLS; no update/delete policies |
| Published history / plans | Everyone | **Only** via the views `public_history`, `public_plans`, `public_status`, which project generalised columns |
| Rate-limit counters | Nobody (service role only) | RLS with no policies |

- `anon` has every table grant revoked and SELECT only on the three public views.
- Public pages and `/api/public/*` read data only through `src/lib/public-data.ts`. A unit test fails if that file queries anything other than `public_*` objects, or if any public page or route touches a Supabase client directly.
- The service-role key is used only in `server-only` modules: public view reads, validated anonymous inserts, and cron jobs. A unit test fails if a client component references a server secret or imports a server module.
- Admin authorisation happens in three places: the proxy (optimistic redirect), the admin layout and pages (`requirePageRole`), and every admin API handler (`requireRole`, enforced by a unit test). RLS is the backstop.
- Revoking a user (role → `none`) takes effect on their next request, because RLS calls `current_role_name()` on every query.

## Publication safeguards

- History is published only from **derived visits** (and optional hourly route samples), never raw points.
- **Live status marker (owner decision, 17 Nov 2026):** the public `public_live_status` view exposes a live colour (green/amber/red/purple/grey), a generalised square centre (shown for green, amber, red and purple; none when stale or within a hidden zone plus half a square) and times. It is off until switched on, and requires a home range first. The home-range centre, the radius and geofence shapes are never exposed. This is a deliberate reversal of spec §8.4's caution: anyone who draws an area can see the marker turn red while the owner is inside it. Areas can be archived by the admin, which takes them out of the calculation immediately.
- Positions are snapped to a stable grid-cell centre (minimum 250 m, default 1 km). Times are rounded down to 15 minutes.
- Nothing is published until at least **one hidden zone** exists. A record is dropped if its point falls in a zone **or if its published grid cell overlaps a zone**, so the cell containing home is never shown.
- Publication starts paused. A missing pause rule is treated as paused.
- Withdrawn records are never resurrected by later runs (`ignoreDuplicates` on `source_key`).
- Plans: drafts and `private` plans never reach the public view. General-area plans publish a 2 km cell centre plus an area/road label. Retrospective plans appear only after they end.
- **Venue privacy (owner decision, 17 Nov 2026):** venues have an `is_public` flag (default **false**). Public venues (pubs, hotels, restaurants…) are published in full, by name and exact position, in plans and in history (`published_locations.venue_name`, `cell_size_m = 0`). Private addresses and custom pinned locations publish only an area/road label and a generalised cell. The server rejects venue precision for a private address unless explicitly confirmed. Switching a venue to private automatically demotes its plans to general area. Healthcare plans also need a confirmation. Hidden zones and excluded categories still apply to public venues.

## Private watch links (owner decision, 17 Nov 2026)

- Each anonymous submitter gets an unguessable 24-character watch token (only its SHA-256 is stored). Areas belong to a token. A token holds at most 10 active areas and 5 push devices.
- `GET /api/watch/:token` returns only that watcher's own areas, the generalised marker position, and the colour relative to *their* areas (red/purple), otherwise green/amber. Other watchers' areas never affect it.
- The public marker (`public_live_status.status` = `live_status.public_status`) is home-based only: green, amber or unknown.
- Push notifications to watchers name the area reference and time only. They are sent only while the live marker is on.
- **Risk accepted by the owner:** a watcher can learn, in near real time, whether the owner is inside areas they choose, including small ones around addresses. Mitigations: the cap of 10 areas, rate limits, admin revoke (`DELETE /api/admin/watchers/:id`), and the global marker switch.
- The marker shows **no position at all until a hidden zone exists** (safety interlock).

## Naming: hidden zones vs areas of concern

- **Hidden zones** (`publication_rules.rule_type = 'exclusion_zone'` in the database) are the owner's own privacy circles, e.g. 250 m around home. They are never shown and are set up in Settings → Home.
- **Areas of concern** (`geofences`) are submitted by the public or the owner. They drive the red and purple marker. The public site never calls them "exclusion zones", because they are not legal restrictions (spec §8.5).

## Address search (third parties)

`/api/geocode` forwards searches server-side to **postcodes.io** (UK postcodes) and **OpenStreetMap Nominatim** (everything else). Search text, including the owner's home address when setting up Home, is therefore sent to those services. Visitors' IPs are not forwarded. Requests are rate-limited (20/min per client), cached for 24 h, and throttled to 1 request per second per Nominatim's usage policy.

## Anonymous submissions

- Validation: Zod schemas, geographic bounds (`GEOFENCE_BOUNDS`), area 500 m² – 8,000 km² (also enforced by a DB check; large enough for a place such as South Yorkshire), centre within the region, ≤50 vertices, no self-intersection, PostGIS `ST_IsValid`.
- Abuse controls: honeypot field, minimum form-fill time (bots get a fake success and nothing is stored), per-client rate limits (geofences 3/h and 10/day; reports 5/h and 20/day).
- Client IPs are **never stored**. A salted SHA-256 hash (`RATE_LIMIT_SALT`) is used for rate limiting and kept on the submission for abuse correlation.
- Attachments: ≤10 MB, type detected by **magic bytes** (JPEG/PNG/WebP/PDF), random object names, original filename discarded. The form warns that photos may carry EXIF location data.
- Submitters receive **no** location information about the tracked person. Anonymous live-location subscriber alerts are **not implemented** (see STATUS.md).

## Notifications

- Delivered only to subscriptions owned by current admins.
- `notifyAdmins` refuses to send any text containing a coordinate pair. Messages carry references and times only.
- Delivery results are persisted in `notification_deliveries`. Expired push subscriptions are disabled automatically.

## Secrets

- `.env*` is git-ignored except `.env.example` (placeholders only).
- Cron and ingest endpoints use a constant-time bearer comparison, and **fail closed** (503) when their secret is unset.

## Verification checklist

Run these against the **deployed** Supabase project. They cannot be fully covered by the static tests in this repo.

1. With only the anon key, `select * from location_observations` (or any private table) returns **zero rows or a permission error**:
   ```bash
   curl "$SUPABASE_URL/rest/v1/location_observations?select=*" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
   ```
2. The same call against `public_history` and `public_plans` succeeds, and the response has no `lat`/`lng`/`venue_id` columns.
3. `rpc/insert_geofence`, `rpc/rate_limit_hit` and `rpc/geofence_signed_distances` with the anon key return permission errors.
4. A signed-in user with role `none` gets empty results for private tables and is redirected away from `/admin`.
5. A reviewer can open `/admin/reports` and `/admin/geofences`, but `/api/admin/locations` returns 403.
6. Set a test admin to `none` and confirm their open session loses access on the next request.
7. Pause publication, run `/api/cron/publish`, and confirm nothing new appears.
8. Add a plan in each publication mode and inspect `/api/public/plans`.
9. Upload a renamed `.html` file as a report attachment: it must be rejected.
10. Exceed the geofence submission rate limit from one IP: the response must be 429.
