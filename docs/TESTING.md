# Testing

## Automated

```bash
npm test          # Vitest: 69 unit + static security tests (no network, no DB)
npm run build
npm run test:e2e  # Playwright smoke tests, desktop + mobile, against `next start`
```

**Unit tests cover:** all four Google Timeline formats (validation, deduplication, E7 overflow, idempotent IDs); the FollowMee parser and HTTP error handling; geofence hysteresis (jitter, accuracy, confirmations); submission validation (bounds, area, self-intersection, honeypot); visit detection; the publication policy (pause, exclusion zones and cell overlap, delay, categories, grid stability, time coarsening); plan validation and public projection; report validation and MIME sniffing; and the coordinate guard on notifications.

**Static security tests cover:** public modules read only `public_*` views; client components contain no secrets or server imports; every admin route checks a role; cron and ingest routes check a bearer secret; the migration enables RLS on every table, grants anon only the public views, keeps private columns out of those views, and revokes server-only functions.

**E2E smoke tests cover:** public pages render; police links; legal-status wording; admin redirect; 401 on private APIs; and no private fields in the public plans API.

## Not automated (needs a seeded Supabase project)

These acceptance criteria need a real database. Run them manually after deployment. An integration suite against a disposable Supabase branch would be the next step.

| Area | Check |
|---|---|
| GPS | Poll ingests; a second poll reports duplicates and no new rows; stale badge appears when the feed stops |
| Imports | Import a real Timeline export; re-import gives 0 new rows; the batch shows file hash and counts |
| Plans | Create a plan on a phone at `/admin/plans`; it appears on `/plans` (all three views); edit and cancel update it; a draft or private plan does not appear; mark completed and confirm the public card says "not a GPS-verified visit" |
| Geofences | Submit an area anonymously; it appears immediately at `/admin/geofences` labelled unverified; a push alert arrives |
| Alerts | Walk into and out of a test area (or POST synthetic points to `/api/locations/ingest`); one enter and one exit alert |
| Reports | Submit with an attachment; reference shown; inbox shows it; status change appears in the audit history |
| Security | The [SECURITY.md checklist](SECURITY.md#verification-checklist) |
