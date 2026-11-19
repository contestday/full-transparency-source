# Full Transparency

A public site for location and activity transparency, with a private administrative dashboard.

**Live:** https://full-transparency.vercel.app (deployed from `master` via Vercel's GitHub integration; every push to `master` redeploys).

- **Public:** delayed, generalised movement history; a Plans Board (list, calendar and map); a confidential report form; anonymous submission of areas of concern; official police reporting links.
- **Private:** FollowMee GPS ingestion, Google Timeline import, live and historical private maps, a mobile Plans Editor, venues, geofence review with entry/exit alerts, a reporting inbox, publication controls and access management.

The app keeps four kinds of record apart: **recorded facts** (GPS observations), **proposed activities** (plans), **unverified concerns** (anonymous areas) and **verified legal restrictions**. They are stored, labelled and displayed separately throughout.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), TypeScript, React 19 |
| Styling | Tailwind CSS v4 with Full Transparency brand tokens (`src/app/ft-tokens.css`). Hand-written shadcn/ui-style primitives in `src/components/ui.tsx` |
| Data | Supabase Postgres + PostGIS, Supabase Auth, Supabase Storage |
| Maps | MapLibre GL JS v6 (default style: OpenFreeMap, no key) |
| Validation | Zod 4 |
| Notifications | Web Push (VAPID), optional email via Resend |
| Tests | Vitest (unit and static security checks), Playwright (smoke e2e) |
| Hosting | Vercel |

## Quick start (local)

```bash
npm install                 # also copies the MapLibre worker into public/maplibre
cp .env.example .env.local  # fill in Supabase keys at minimum
npm run dev
```

Without Supabase variables the public pages render empty, and admin and API routes fail closed (401/503).

Set up the database, the first administrator and production deployment by following **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | ESLint |
| `npm run typecheck` | Route type generation + `tsc` |
| `npm test` | Vitest unit + static security tests |
| `npm run test:e2e` | Playwright smoke tests (builds must exist: run `npm run build` first) |

## Layout

```
src/app/(public)/      public pages: /, /history, /plans{,/calendar,/map}, /report, /geofences/submit, /about
src/app/admin/         private dashboard (role-checked in layout + every page)
src/app/api/           route handlers (public, admin, cron, ingest)
src/lib/               domain logic. Pure modules are unit-tested:
  timeline/parse.ts      Google Timeline adapters (4 export formats)
  followmee.ts           FollowMee client + tolerant parser
  geofence/              submission validation + entry/exit hysteresis
  visits.ts              stay-point (visit) detection
  publication.ts         publication policy (delay, grid, exclusions, pause)
  plans.ts               plan schema, categories, public projection
  jobs/                  FollowMee polling and publication processing
  public-data.ts         the ONLY data source for public pages (public_* views)
supabase/migrations/   schema, RLS, views, functions, storage bucket
docs/                  deployment, security, FollowMee, testing, status
full-transparency-assets/  original asset pack (source; copies live in public/ and src/app)
```

## Documentation

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Supabase, Vercel, environment variables, scheduling, first admin
- [docs/SECURITY.md](docs/SECURITY.md): data isolation model, threat notes, verification checklist
- [docs/FOLLOWMEE.md](docs/FOLLOWMEE.md): integration details and what must be verified against your account
- [docs/TESTING.md](docs/TESTING.md): automated and manual acceptance testing
- [docs/STATUS.md](docs/STATUS.md): **what is complete, partial and not implemented**
