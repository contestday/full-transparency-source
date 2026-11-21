/**
 * Static security checks over the source tree. These do not replace testing RLS
 * against a live database (see docs/SECURITY.md), but they catch regressions
 * such as a public module querying a private table or a secret leaking into
 * client code.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((f) => {
    const rel = path.join(dir, f);
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

const PRIVATE_TABLES = [
  "location_observations",
  "location_import_batches",
  "visits",
  "published_locations",
  "planned_activities",
  "venues",
  "plan_wishes",
  "watch_events",
  "watch_event_places",
  "watch_event_state",
  "watch_event_log",
  "geofences",
  "geofence_events",
  "geofence_state",
  "incident_reports",
  "report_attachments",
  "report_notes",
  "notification_subscriptions",
  "publication_rules",
  "audit_events",
  "profiles",
  "live_status",
  "watchers",
  "watcher_push_subscriptions",
  "plan_locations",
  "watcher_contacts",
];

const sourceFiles = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));

describe("public data access", () => {
  it("public-data.ts only queries public_* views", () => {
    const src = read("src/lib/public-data.ts");
    const froms = [...src.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(0);
    for (const t of froms) expect(t.startsWith("public_")).toBe(true);
  });

  it("public pages and public API routes never query tables directly", () => {
    const publicFiles = sourceFiles.filter(
      (f) => f.includes(`${path.sep}(public)${path.sep}`) || f.includes(`api${path.sep}public${path.sep}`),
    );
    expect(publicFiles.length).toBeGreaterThan(5);
    for (const f of publicFiles) {
      const src = read(f);
      expect(src, f).not.toMatch(/\.from\(/);
      expect(src, f).not.toMatch(/createServiceClient|createUserClient/);
    }
  });
});

describe("secrets stay server-side", () => {
  const clientFiles = sourceFiles.filter((f) => /^["']use client["']/m.test(read(f)));

  it("there are client components to check", () => {
    expect(clientFiles.length).toBeGreaterThan(5);
  });

  it("client components never reference server secrets or the service client", () => {
    for (const f of clientFiles) {
      const src = read(f);
      for (const secret of ["SUPABASE_SERVICE_ROLE_KEY", "FOLLOWMEE_API_KEY", "VAPID_PRIVATE_KEY", "CRON_SECRET", "GPS_INGEST_SECRET", "RESEND_API_KEY"]) {
        expect(src, `${f} references ${secret}`).not.toContain(secret);
      }
      // `import type` is erased at compile time, so it cannot pull server code into the bundle.
      const valueImports = src.replace(/^import type .*$/gm, "");
      expect(valueImports, f).not.toMatch(/supabase\/server|lib\/(ingest|notify|audit|rate-limit|auth|public-data)["']/);
    }
  });

  it("no secret is exposed via a NEXT_PUBLIC_ name", () => {
    const all = sourceFiles.map(read).join("\n") + read(".env.example");
    expect(all).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SERVICE|SECRET|PRIVATE|FOLLOWMEE)/);
  });

  it("server modules that hold secrets are marked server-only", () => {
    for (const f of ["src/lib/supabase/server.ts", "src/lib/notify.ts", "src/lib/ingest.ts", "src/lib/auth.ts", "src/lib/public-data.ts", "src/lib/rate-limit.ts"]) {
      expect(read(f), f).toMatch(/import "server-only"/);
    }
  });
});

describe("admin API routes require authorisation", () => {
  const adminRoutes = sourceFiles.filter((f) => f.includes(`api${path.sep}admin${path.sep}`) && f.endsWith("route.ts"));
  it("every exported handler checks a role", () => {
    expect(adminRoutes.length).toBeGreaterThan(10);
    for (const f of adminRoutes) {
      const src = read(f);
      const handlers = [...src.matchAll(/export const (GET|POST|PATCH|DELETE|PUT)/g)].length;
      const checks = [...src.matchAll(/requireRole\(/g)].length;
      expect(checks, f).toBeGreaterThanOrEqual(handlers);
    }
  });
  it("import and cron/ingest routes are protected", () => {
    expect(read("src/app/api/imports/timeline/route.ts")).toMatch(/requireRole\(\["admin"\]\)/);
    expect(read("src/app/api/locations/ingest/route.ts")).toMatch(/requireBearer\(request, optionalEnv\("GPS_INGEST_SECRET"\)\)/);
    expect(read("src/app/api/cron/followmee/route.ts")).toMatch(/requireBearer\(request, optionalEnv\("CRON_SECRET"\)\)/);
    expect(read("src/app/api/cron/publish/route.ts")).toMatch(/requireBearer\(request, optionalEnv\("CRON_SECRET"\)\)/);
  });
});

describe("database migration", () => {
  const sql = readdirSync(path.join(ROOT, "supabase/migrations"))
    .map((f) => read(`supabase/migrations/${f}`))
    .join("\n");

  it("enables RLS on every table it creates", () => {
    const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(15);
    for (const t of tables) expect(sql, t).toContain(`alter table public.${t} enable row level security`);
  });

  it("grants anon access only to the public views", () => {
    const grants = [...new Set([...sql.matchAll(/grant select on public\.(\w+) to anon/g)].map((m) => m[1]))];
    expect(grants.sort()).toEqual(["public_history", "public_live_status", "public_plan_locations", "public_plans", "public_status"]);
    for (const t of PRIVATE_TABLES) expect(sql).not.toMatch(new RegExp(`grant [^;]* on public\\.${t} to anon`));
  });

  it("public views do not expose precise private columns", () => {
    // Use the LATEST definition: later migrations replace views.
    const view = (name: string) => [...sql.matchAll(new RegExp(`create or replace view public\\.${name}[\\s\\S]*?;`, "g"))].at(-1)![0];
    expect(view("public_history")).not.toMatch(/\blat\b|\blng\b|source_visit_id|withdrawn/);
    const plans = view("public_plans");
    expect(plans).not.toMatch(/p\.lat\b|p\.lng\b|v\.lat|v\.lng|address/);
    expect(plans).toMatch(/publication_mode <> 'private'/);
    expect(plans).toMatch(/status <> 'draft'/);
    const live = view("public_live_status");
    expect(live).not.toMatch(/home_inside|home_pending|s\.lat\b|s\.lng\b/);
    expect(live).toMatch(/case when r\.enabled then s\.public_lat/);
  });

  it("revokes server-only functions from PUBLIC", () => {
    for (const fn of ["rate_limit_hit", "insert_geofence", "geofence_signed_distances", "geofence_nesting"]) {
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
    }
  });
});

describe("watcher anonymity", () => {
  it("the save-my-link buttons never contact our server (email goes from the visitor, to the visitor)", () => {
    const src = read("src/components/save-watch-link.tsx");
    expect(src).toMatch(/mailto:\?subject=/); // opens the visitor's own email app, no recipient pre-filled
    for (const forbidden of [/\bfetch\(/, /XMLHttpRequest/, /sendBeacon/, /["'`]\/api\//, /WebSocket/]) {
      expect(src, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("no table stores a watcher's email address", () => {
    const sql = readdirSync(path.join(ROOT, "supabase/migrations")).map((f) => read(`supabase/migrations/${f}`)).join("\n");
    const watchers = sql.match(/create table public\.watchers \(([\s\S]*?)\);/)![1];
    expect(watchers).not.toMatch(/email|phone|name\b/i);
    const geofences = sql.match(/create table public\.geofences \(([\s\S]*?)\);/)![1];
    expect(geofences).not.toMatch(/email/i);
  });
});
