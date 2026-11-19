# Deployment checklist

## 1. Supabase project

1. Create a Supabase project (choose an EU/UK region).
2. **Database → Extensions:** PostGIS is enabled by the migration (`create extension postgis with schema extensions`). If your project restricts this, enable *postgis* in the dashboard first.
3. Apply the migration in `supabase/migrations/`, by either:
   - Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`, or
   - Dashboard SQL editor: paste and run each file in `supabase/migrations/` in name order (`…0001` to `…0006`), once each.
4. **Authentication → Providers:** keep Email enabled. **Disable public sign-ups** (Authentication → Settings → "Allow new users to sign up" = off). Staff are invited, not self-registered. New users get role `none` and see nothing.
5. **Authentication → URL configuration:** set Site URL to your production URL. Add `https://<domain>/auth/callback` to the redirect URLs (used by magic links).
6. Invite yourself: **Authentication → Users → Invite**. Accept the invite and set a password.
7. Promote yourself to administrator (SQL editor):

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

   Later admins and reviewers can be managed in **/admin/settings → Access**.

## 2. Vercel project

1. Import the Git repository into Vercel. Framework preset: Next.js. No build overrides are needed.
2. **Settings → Environment Variables:** add every variable from `.env.example` for *Production* (and *Preview* if you use previews against a separate Supabase project):

| Variable | Where it comes from | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | Browser (safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same | Browser (safe: RLS on every table) |
| `SUPABASE_SERVICE_ROLE_KEY` | same | **Server only** |
| `FOLLOWMEE_API_KEY`, `FOLLOWMEE_USERNAME`, `FOLLOWMEE_DEVICE_ID` | FollowMee account → API / Devices | **Server only** |
| `CRON_SECRET` | `openssl rand -hex 32` | **Server only.** Vercel Cron sends it automatically |
| `GPS_INGEST_SECRET` | `openssl rand -hex 32` | **Server only** |
| `RATE_LIMIT_SALT` | `openssl rand -hex 32` | **Server only** |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npx web-push generate-vapid-keys` | Private key server only |
| `RESEND_API_KEY`, `NOTIFICATION_EMAIL_FROM` | Resend (optional) | **Server only** |
| `APP_BASE_URL` | your canonical origin | Server (used for metadata and email links) |
| `NEXT_PUBLIC_MAP_STYLE_URL` | any MapLibre style | Browser |
| `STALE_AFTER_MINUTES`, `GEOFENCE_BOUNDS` | optional tuning | Server |

3. Deploy. `npm install` runs `postinstall`, which copies the MapLibre worker into `public/maplibre/`.

## 3. Scheduling (FollowMee polling and publication)

`vercel.json` registers two **daily** crons, which work on every Vercel plan:

| Path | Schedule | Purpose |
|---|---|---|
| `/api/cron/followmee` | 06:00 UTC | Poll FollowMee (catches up to 72 h of history) |
| `/api/cron/publish` | 06:30 UTC | Derive visits and publish under the policy |

**Daily is not enough for timely geofence alerts.** Vercel Hobby allows only daily crons. Choose one of the following for frequent polling:

- **Vercel Pro:** change the schedule in `vercel.json`, e.g. `"*/5 * * * *"`.
- **Supabase pg_cron + pg_net (any plan):** enable both extensions, store the secret in Vault, then:

  ```sql
  select vault.create_secret('<CRON_SECRET value>', 'ft_cron_secret');
  select cron.schedule('ft-followmee', '*/2 * * * *', $$
    select net.http_get(
      url := 'https://<your-domain>/api/cron/followmee',
      headers := jsonb_build_object('Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'ft_cron_secret'))
    );
  $$);
  select cron.schedule('ft-publish', '15 * * * *', $$
    select net.http_get(
      url := 'https://<your-domain>/api/cron/publish',
      headers := jsonb_build_object('Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'ft_cron_secret'))
    );
  $$);
  ```

- **Any external scheduler** (e.g. cron-job.org) calling the same URLs with the `Authorization: Bearer` header.

**Recommended: poll every 2–5 minutes** (e.g. `*/3 * * * *`). This has been confirmed acceptable for this account; see [FOLLOWMEE.md](FOLLOWMEE.md). Publication only needs to run hourly.

## 4. First-run configuration (in the app)

1. Sign in at `/login` and open **/admin/settings**.
2. In **Settings → Home and live marker**, search your postcode or address and **Save home**. This creates the hidden zone (default 250 m) and the okay zone (default 3 miles). Publication is blocked until at least one hidden zone exists.
3. Review the delay (default 24 h), grid size (default 1 km) and excluded categories (healthcare by default).
4. Publication starts **paused**. Press **Resume publication** when you are satisfied.
5. **Enable push on this device** (on iPhone, add the site to the Home Screen first), then **Send test notification**.
6. Optionally import Google Timeline history at **/admin/imports**.
7. On the dashboard, use **Poll FollowMee now** to confirm the integration works.

## 5. Go-live verification

Work through the security checklist in [SECURITY.md](SECURITY.md#verification-checklist) against the deployed project before announcing the site.
