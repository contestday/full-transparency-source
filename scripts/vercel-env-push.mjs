// Copies environment variables from .env.local into the linked Vercel project
// (Production + Preview) using the Vercel CLI. Values are piped via stdin and
// never printed. Run after `npx vercel login` and `npx vercel link`.
//
//   node scripts/vercel-env-push.mjs                 # push all known keys
//   node scripts/vercel-env-push.mjs APP_BASE_URL=https://your-site.vercel.app
//
// Keys that are empty in .env.local are skipped. Existing values are replaced.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf("=");
  if (i > 0) env[arg.slice(0, i)] = arg.slice(i + 1);
}

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "FOLLOWMEE_API_KEY",
  "FOLLOWMEE_USERNAME",
  "FOLLOWMEE_DEVICE_ID",
  "STALE_AFTER_MINUTES",
  "CRON_SECRET",
  "GPS_INGEST_SECRET",
  "RATE_LIMIT_SALT",
  "NEXT_PUBLIC_MAP_STYLE_URL",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "RESEND_API_KEY",
  "NOTIFICATION_EMAIL_FROM",
  "APP_BASE_URL",
  "GEOFENCE_BOUNDS",
  "NEXT_PUBLIC_INCOGNEATO_URL",
  "NEXT_PUBLIC_INCOGNEATO_BOX",
];

const vercel = (args, input) =>
  spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", "vercel@latest", ...args], {
    cwd: root,
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

for (const key of KEYS) {
  const value = env[key];
  if (!value) {
    console.log(`skip   ${key} (empty)`);
    continue;
  }
  if (key === "APP_BASE_URL" && value.includes("localhost")) {
    console.log(`skip   ${key} (still localhost; pass APP_BASE_URL=https://… on the command line)`);
    continue;
  }
  for (const target of ["production", "preview"]) {
    vercel(["env", "rm", key, target, "--yes"]);
    const r = vercel(["env", "add", key, target], value);
    console.log(`${r.status === 0 ? "set   " : "FAILED"} ${key} → ${target}${r.status === 0 ? "" : `: ${(r.stderr || r.stdout).split("\n").slice(-3).join(" ").slice(0, 200)}`}`);
  }
}
