/**
 * Backfill `visits` from the stays Google already computed in an on-device
 * (Android) Timeline export (`semanticSegments[].visit`).
 *
 *   npx tsx scripts/backfill-google-visits.ts [path/to/Timeline.json] [--dry-run] [--no-cursor]
 *
 * - One row per visit segment, including nested child visits (kept since
 *   18 Nov 2026: a shop inside a shopping centre is a real, more specific stop).
 * - source = 'google_timeline', upsert on (source, started_at) => idempotent.
 * - Skips invalid coordinates and stays shorter than 5 minutes.
 * - confidence = visit.probability (fallback topCandidate.probability), clamped 0..1.
 * - observation_count = parsed observations from the same file within the stay
 *   (the file was imported 1:1 into location_observations).
 * - category/venue_id only from a known venue within 75 m (same rule as
 *   deriveVisits). Google's semanticType (HOME/WORK/...) is NOT stored; it is
 *   only counted in the summary.
 * - Sets system_state.visits_cursor to the end of the Google history so the
 *   derive job does not re-derive duplicate visits from imported observations
 *   (skip with --no-cursor).
 *
 * Output never contains coordinates or place IDs.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseLatLngString, parseTimeline } from "@/lib/timeline/parse";
import { haversineMeters, isValidLatLng } from "@/lib/geo";

const MIN_STAY_MS = 5 * 60_000;
const VENUE_MATCH_M = 75;
const BATCH = 500;

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const prob = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

/** Number of sorted timestamps t with lo <= t <= hi. */
function countBetween(sorted: number[], lo: number, hi: number): number {
  const lower = (x: number) => {
    let a = 0,
      b = sorted.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (sorted[m] < x) a = m + 1;
      else b = m;
    }
    return a;
  };
  return lower(hi + 1) - lower(lo);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const noCursor = args.includes("--no-cursor");
  const file = args.find((a) => !a.startsWith("--")) ?? "uploads/Timeline.json";

  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const data = JSON.parse(readFileSync(file, "utf8")) as Obj;
  const segments = Array.isArray(data.semanticSegments) ? (data.semanticSegments as unknown[]) : [];
  if (!segments.length) throw new Error("No semanticSegments found: this script supports the Android on-device export only.");

  // Observation timestamps (same parser as the admin importer => same rows as in the DB).
  const parsed = parseTimeline(data);
  const obsTimes = parsed.observations.map((o) => Date.parse(o.observedAt)).sort((a, b) => a - b);

  const { data: venues, error: vErr } = await sb.from("venues").select("id, category, lat, lng").not("lat", "is", null);
  if (vErr) throw vErr;

  const stats = {
    visitSegments: 0,
    nestedIncluded: 0,
    invalidSkipped: 0,
    shortSkipped: 0,
    duplicateStartSkipped: 0,
    venueMatched: 0,
    semanticTypes: {} as Record<string, number>,
  };
  const rows = new Map<string, Record<string, unknown>>();
  let historyEnd = 0;

  for (const raw of segments) {
    const s = obj(raw);
    const end = Date.parse(String(s.endTime ?? ""));
    if (Number.isFinite(end)) historyEnd = Math.max(historyEnd, end);
    if (!s.visit) continue;
    stats.visitSegments++;
    const visit = obj(s.visit);
    // Nested visits (a shop inside a shopping centre) are real, more specific
    // stops: keep them (counted here for the summary).
    if (typeof visit.hierarchyLevel === "number" && visit.hierarchyLevel > 0) stats.nestedIncluded++;
    const cand = obj(visit.topCandidate);
    const ll = parseLatLngString(obj(cand.placeLocation).latLng);
    const start = Date.parse(String(s.startTime ?? ""));
    if (!ll || !isValidLatLng(ll.lat, ll.lng) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      stats.invalidSkipped++;
      continue;
    }
    if (end - start < MIN_STAY_MS) {
      stats.shortSkipped++;
      continue;
    }
    const startedAt = new Date(start).toISOString();
    // Same start as an earlier visit: keep the more specific (nested) one.
    const nested = typeof visit.hierarchyLevel === "number" && visit.hierarchyLevel > 0;
    if (rows.has(startedAt) && !nested) {
      stats.duplicateStartSkipped++;
      continue;
    }
    const type = typeof cand.semanticType === "string" ? cand.semanticType : "NONE";
    stats.semanticTypes[type] = (stats.semanticTypes[type] ?? 0) + 1;

    const venue = (venues ?? [])
      .map((v) => ({ v, d: haversineMeters(ll, { lat: v.lat as number, lng: v.lng as number }) }))
      .filter((x) => x.d <= VENUE_MATCH_M)
      .sort((a, b) => a.d - b.d)[0]?.v;
    if (venue) stats.venueMatched++;

    rows.set(startedAt, {
      source: "google_timeline",
      started_at: startedAt,
      ended_at: new Date(end).toISOString(),
      lat: ll.lat,
      lng: ll.lng,
      radius_m: null,
      category: venue?.category ?? null,
      venue_id: venue?.id ?? null,
      observation_count: countBetween(obsTimes, start, end),
      confidence: prob(visit.probability) ?? prob(cand.probability) ?? 0.5,
      planned_activity_id: null,
    });
  }

  const list = [...rows.values()];
  const homeWork = Object.entries(stats.semanticTypes)
    .filter(([k]) => /HOME|WORK/.test(k))
    .reduce((n, [, c]) => n + c, 0);
  console.log(JSON.stringify({ file, dryRun, ...stats, toUpsert: list.length, homeOrWorkTyped: homeWork }, null, 2));

  if (!dryRun) {
    for (let i = 0; i < list.length; i += BATCH) {
      const { error } = await sb.from("visits").upsert(list.slice(i, i + BATCH), { onConflict: "source,started_at" });
      if (error) throw error;
    }
    console.log(`upserted ${list.length} google_timeline visits`);
  }

  if (!noCursor && historyEnd > 0) {
    // Start the derive job just after the Google history: it then only sees
    // newer (live) observations and never re-derives the imported stays.
    const cursor = new Date(historyEnd + 1000).toISOString();
    const { data: prev } = await sb.from("system_state").select("value").eq("key", "visits_cursor").maybeSingle();
    console.log(`visits_cursor: ${JSON.stringify(prev?.value ?? null)} -> {"cursor":"${cursor}"}${dryRun ? " (dry run, not written)" : ""}`);
    if (!dryRun) {
      const { error } = await sb
        .from("system_state")
        .upsert({ key: "visits_cursor", value: { cursor }, updated_at: new Date().toISOString() }, { onConflict: "key" });
      if (error) throw error;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
