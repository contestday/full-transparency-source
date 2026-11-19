/**
 * Re-publish the public history at exact GPS positions (owner decision,
 * 18 Nov 2026: "exact everything", home still hidden).
 *
 *   npx tsx scripts/republish-exact.ts            (dry run: counts only)
 *   npx tsx scripts/republish-exact.ts --apply    (sets grid = 0 and rewrites)
 *
 * - Sets the publication "grid" rule to 0 m (exact) with --apply.
 * - Route samples: moved from their 250 m square to the original GPS reading.
 * - Stays: exact position, times to the minute, venue name (public venues) or
 *   a place name (reverse geocoded: a public place's name, or street and
 *   district; never a house number). Cached in uploads/reverse-cache.json.
 * - Stays never published before (e.g. newly imported Google stays) are added.
 * - Anything inside an exclusion zone is not published; withdrawn records are
 *   never touched.
 * Output never contains coordinates.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildPolicy, decide, type Candidate, type PublicationRuleRow } from "@/lib/publication";
import { reverseLabel } from "@/lib/geocode";

const APPLY = process.argv.includes("--apply");
const PAGE = 1000;
const CACHE = "uploads/reverse-cache.json";

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const all = async <T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) => {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) return out;
    }
  };

  // 1. Policy at exact positions.
  const { data: ruleRows, error: rErr } = await sb.from("publication_rules").select("id, rule_type, configuration, enabled");
  if (rErr) throw rErr;
  const rules = (ruleRows ?? []) as (PublicationRuleRow & { id: string })[];
  const grid = rules.find((r) => r.rule_type === "grid");
  const policy = buildPolicy(rules.map((r) => (r.rule_type === "grid" ? { ...r, configuration: { ...r.configuration, meters: 0 }, enabled: true } : r)));
  if (policy.gridM !== 0 || !policy.exclusionZones.length) throw new Error("Refusing: exact policy not built, or no exclusion zone set");
  policy.delayHours = 0;

  // 2. Source data.
  const venues = await all<{ id: string; name: string; is_public: boolean; lat: number | null; lng: number | null; public_area_label: string | null }>((f, t) =>
    sb.from("venues").select("id, name, is_public, lat, lng, public_area_label").range(f, t),
  );
  const venueById = new Map(venues.map((v) => [v.id, v]));
  const visits = await all<{ id: string; started_at: string; ended_at: string; lat: number; lng: number; radius_m: number | null; category: string | null; venue_id: string | null }>(
    (f, t) => sb.from("visits").select("id, started_at, ended_at, lat, lng, radius_m, category, venue_id").order("started_at").range(f, t),
  );
  const obs = await all<{ observed_at: string; lat: number; lng: number; accuracy_m: number | null }>((f, t) =>
    sb.from("location_observations").select("observed_at, lat, lng, accuracy_m").eq("validation_status", "valid").order("observed_at").range(f, t),
  );
  const good = obs.filter((o) => o.accuracy_m === null || o.accuracy_m <= 200).map((o) => ({ ...o, t: Date.parse(o.observed_at) }));
  const published = await all<Record<string, unknown> & { id: string; source_key: string; kind: string; visibility_status: string }>((f, t) =>
    sb.from("published_locations").select("*").order("id").range(f, t),
  );
  const byKey = new Map(published.map((p) => [p.source_key, p]));
  console.log(JSON.stringify({ visits: visits.length, observations: good.length, published: published.length, venues: venues.length }));

  // First good reading at or after t (binary search).
  const firstFrom = (t: number) => {
    let lo = 0;
    let hi = good.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (good[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return good[lo];
  };

  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const withdraw: string[] = [];
  const stats = { tracksMoved: 0, tracksNoSource: 0, staysUpdated: 0, staysAdded: 0, staysExcluded: 0, labelsNeeded: 0, withdrawnSkipped: 0 };

  // 3. Route samples.
  for (const p of published) {
    if (p.kind !== "track") continue;
    if (p.visibility_status !== "published") {
      stats.withdrawnSkipped++;
      continue;
    }
    const bucket = Number(p.source_key.split(":")[1]);
    const o = Number.isFinite(bucket) ? firstFrom(bucket) : undefined;
    if (!o || o.t - bucket > 60 * 60_000) {
      stats.tracksNoSource++;
      continue;
    }
    const d = decide({ key: p.source_key, kind: "track", lat: o.lat, lng: o.lng, observedAt: new Date(bucket).toISOString() }, policy);
    if (!d.publish) {
      withdraw.push(p.id);
      continue;
    }
    updates.push({ ...p, public_lat: d.record.public_lat, public_lng: d.record.public_lng, cell_size_m: 0 });
    stats.tracksMoved++;
  }

  // 4. Stays.
  const cache: Record<string, string | null> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  const pendingLabels: Record<string, unknown>[] = [];
  for (const v of visits) {
    const key = `visit:${v.id}`;
    const existing = byKey.get(key);
    if (existing && existing.visibility_status !== "published") {
      stats.withdrawnSkipped++;
      continue;
    }
    const ven = v.venue_id ? venueById.get(v.venue_id) : null;
    const c: Candidate = {
      key,
      kind: "visit",
      visitId: v.id,
      lat: v.lat,
      lng: v.lng,
      radiusM: v.radius_m ?? 0,
      category: v.category,
      observedAt: v.started_at,
      observedUntil: v.ended_at,
      areaLabelHint: ven?.public_area_label ?? null,
      publicVenue: ven?.is_public && ven.lat != null && ven.lng != null ? { lat: ven.lat, lng: ven.lng, name: ven.name } : null,
    };
    const d = decide(c, policy);
    if (!d.publish) {
      if (d.reason === "exclusion_zone" || d.reason === "category") {
        stats.staysExcluded++;
        if (existing) withdraw.push(existing.id);
      }
      continue;
    }
    const row = existing ? { ...existing, ...d.record } : { ...d.record, visibility_status: "published" };
    if (!row.venue_name && !row.area_label) pendingLabels.push(row);
    if (existing) {
      updates.push(row);
      stats.staysUpdated++;
    } else {
      inserts.push(row);
      stats.staysAdded++;
    }
  }
  stats.labelsNeeded = pendingLabels.filter((r) => !(`${Number(r.public_lat).toFixed(4)},${Number(r.public_lng).toFixed(4)}` in cache)).length;
  console.log(JSON.stringify({ apply: APPLY, ...stats, withdrawals: withdraw.length }, null, 2));
  if (!APPLY) return;

  // 5. Place names (1 request/second; cached so reruns are quick).
  let done = 0;
  for (const r of pendingLabels) {
    const k = `${Number(r.public_lat).toFixed(4)},${Number(r.public_lng).toFixed(4)}`;
    if (!(k in cache)) {
      await new Promise((res) => setTimeout(res, 1100));
      cache[k] = await reverseLabel(Number(r.public_lat), Number(r.public_lng));
      if (++done % 50 === 0) {
        writeFileSync(CACHE, JSON.stringify(cache));
        console.log(`labels: ${done}/${stats.labelsNeeded}`);
      }
    }
    r.area_label = cache[k];
  }
  writeFileSync(CACHE, JSON.stringify(cache));

  // Generated columns (public_position) are computed by the database: never send them.
  const strip = (r: Record<string, unknown>) => {
    const { public_position: _omit, ...rest } = r;
    void _omit;
    return rest;
  };
  for (let i = 0; i < updates.length; i++) updates[i] = strip(updates[i]);
  for (let i = 0; i < inserts.length; i++) inserts[i] = strip(inserts[i]);

  // 6. Write: grid rule first, then records.
  if (grid) {
    const { error } = await sb.from("publication_rules").update({ configuration: { ...grid.configuration, meters: 0 }, enabled: true, updated_at: new Date().toISOString() }).eq("id", grid.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("publication_rules").insert({ rule_type: "grid", configuration: { meters: 0 }, enabled: true });
    if (error) throw error;
  }
  for (let i = 0; i < updates.length; i += 500) {
    const { error } = await sb.from("published_locations").upsert(updates.slice(i, i + 500), { onConflict: "id" });
    if (error) throw error;
  }
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await sb.from("published_locations").upsert(inserts.slice(i, i + 500), { onConflict: "source_key", ignoreDuplicates: true });
    if (error) throw error;
  }
  for (let i = 0; i < withdraw.length; i += 200) {
    const { error } = await sb
      .from("published_locations")
      .update({ visibility_status: "withdrawn", withdrawn_at: new Date().toISOString(), withdrawn_reason: "exact republish: inside an exclusion zone" })
      .in("id", withdraw.slice(i, i + 200));
    if (error) throw error;
  }
  console.log(`done: ${updates.length} updated, ${inserts.length} added, ${withdraw.length} withdrawn`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : JSON.stringify(e));
  process.exit(1);
});
