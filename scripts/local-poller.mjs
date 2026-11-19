// Local stand-in for the production scheduler while developing on this PC.
// Calls the app's own cron endpoints with CRON_SECRET from .env.local:
//   FollowMee poll   every POLL_MINUTES (default 3)
//   publication job  every PUBLISH_MINUTES (default 60)
// Usage: npm run poll:local   (the dev server must be running on BASE_URL)
// In production, use Supabase pg_cron or Vercel Cron instead (docs/DEPLOYMENT.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const POLL_MIN = Number(process.env.POLL_MINUTES ?? 3);
const PUBLISH_MIN = Number(process.env.PUBLISH_MINUTES ?? 60);
if (!env.CRON_SECRET) {
  console.error("CRON_SECRET missing from .env.local");
  process.exit(1);
}

async function hit(pathname) {
  const started = new Date().toLocaleTimeString("en-GB");
  try {
    const res = await fetch(`${BASE}${pathname}`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
    const body = await res.json().catch(() => ({}));
    const summary =
      pathname.includes("followmee")
        ? `new=${body.inserted ?? "?"} dup=${body.duplicates ?? "?"} status=${body.liveStatus ?? "?"} stale=${body.stale}`
        : `published=${body.published?.published ?? "?"} (${body.published?.status ?? body.error ?? "?"})`;
    console.log(`[${started}] ${pathname} → ${res.status} ${summary}`);
  } catch (e) {
    console.log(`[${started}] ${pathname} → failed: ${e.message}`);
  }
}

// PUBLISH_MINUTES=0 disables the publication job (FollowMee polling only).
console.log(`Local poller: FollowMee every ${POLL_MIN} min, publication ${PUBLISH_MIN > 0 ? `every ${PUBLISH_MIN} min` : "off"} → ${BASE}`);
await hit("/api/cron/followmee");
setInterval(() => hit("/api/cron/followmee"), POLL_MIN * 60_000);
if (PUBLISH_MIN > 0) {
  await hit("/api/cron/publish");
  setInterval(() => hit("/api/cron/publish"), PUBLISH_MIN * 60_000);
}
