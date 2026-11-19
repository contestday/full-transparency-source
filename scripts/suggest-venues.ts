/**
 * Suggest named venues for frequently visited places, using OpenStreetMap.
 *
 *   npx tsx scripts/suggest-venues.ts [--dry-run] [--max-lookups=60] [--max-suggestions=40] [--timeline=uploads/Timeline.json]
 *
 * 1. Clusters all `visits` within ~60 m and ranks clusters by visits in the
 *    last 3 years (then total time).
 * 2. Excludes, before any network lookup:
 *    - clusters overlapping a hidden zone (publication_rules.exclusion_zone),
 *    - clusters containing a visit Google marked HOME / INFERRED_HOME
 *      (matched by start time against the Timeline export).
 * 3. Looks up the largest remaining clusters on OSM (Overpass first, Nominatim
 *    reverse as fallback; <= 1 request/s per service; responses cached in
 *    uploads/osm-cache.json so re-runs do not hit the APIs again). Places that
 *    only resolve to a house / residential address are skipped.
 * 4. Writes suggestions to `venues` with is_public = false and
 *    metadata = {suggested, status:"pending", source:"agent", osm, visit_count,
 *    total_minutes, last_visit, match_distance_m}. An existing venue within 75 m
 *    with a similar name (or the same OSM id) is reused instead of duplicated;
 *    venues the owner created or confirmed are never modified.
 * 5. Links visits within 75 m (venue_id + category), never overriding a visit
 *    already linked to another venue, and never linking HOME-typed visits or
 *    visits inside a hidden zone.
 *
 * Output never contains coordinates.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { haversineMeters, type LatLng } from "@/lib/geo";

const CLUSTER_M = 60;
const LOOKUP_RADIUS_M = 60;
const LINK_M = 75;
const RECENT_MS = 3 * 365.25 * 24 * 3600_000;
const UA = "FullTransparency/0.1 (self-hosted location transparency site)";
const CACHE_FILE = "uploads/osm-cache.json";

const args = process.argv.slice(2);
const flag = (name: string, def: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? def;
const DRY = args.includes("--dry-run");
const MAX_LOOKUPS = Number(flag("max-lookups", "60"));
const MAX_SUGGESTIONS = Number(flag("max-suggestions", "40"));
const TIMELINE = flag("timeline", "uploads/Timeline.json");

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// ---------------------------------------------------------------- OSM access
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const cache: Record<string, unknown> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
const lastCall: Record<string, number> = {};
let networkCalls = 0;

async function fetchJson(service: string, url: string, init?: RequestInit): Promise<unknown> {
  const key = `${url}|${init?.body ?? ""}`;
  if (key in cache) return cache[key];
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = (lastCall[service] ?? 0) + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall[service] = Date.now();
    networkCalls++;
    const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init?.headers ?? {}) } });
    if (res.status === 429 || res.status >= 500) {
      console.warn(`${service}: HTTP ${res.status}, retrying`);
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${service} HTTP ${res.status}`);
    const body = await res.json();
    cache[key] = body;
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
    return body;
  }
  throw new Error(`${service}: giving up after retries`);
}

const r6 = (n: number) => n.toFixed(6);

let overpassFailures = 0;
/** Named POIs within the lookup radius, or null when Overpass is unavailable. */
async function overpass(p: LatLng): Promise<Json[] | null> {
  if (overpassFailures >= 5) return null; // service down: stop hammering it, use Nominatim
  try {
    return await overpassQuery(p);
  } catch (e) {
    overpassFailures++;
    console.warn(`overpass unavailable (${(e as Error).message}); falling back to Nominatim`);
    return null;
  }
}

async function overpassQuery(p: LatLng): Promise<Json[]> {
  const a = `(around:${LOOKUP_RADIUS_M},${r6(p.lat)},${r6(p.lng)})`;
  const q =
    `[out:json][timeout:25];(` +
    ["amenity", "tourism", "shop", "leisure", "healthcare", "office", "railway", "aeroway", "public_transport", "club", "sport"]
      .map((k) => `nwr${a}[name][${k}];`)
      .join("") +
    `);out center tags;`;
  const body = (await fetchJson("overpass", "https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: `data=${encodeURIComponent(q)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  })) as Json;
  return (body.elements ?? []) as Json[];
}

async function nominatimReverse(p: LatLng): Promise<Json> {
  return (await fetchJson(
    "nominatim",
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${r6(p.lat)}&lon=${r6(p.lng)}`,
  )) as Json;
}

async function nominatimLookup(osm: string): Promise<Json | null> {
  const [type, id] = osm.split("/");
  const body = (await fetchJson(
    "nominatim",
    `https://nominatim.openstreetmap.org/lookup?format=jsonv2&addressdetails=1&osm_ids=${type[0].toUpperCase()}${id}`,
  )) as Json[];
  return body?.[0] ?? null;
}

// ------------------------------------------------------- category & plausibility
const IGNORED: Record<string, string[]> = {
  amenity: ["parking", "parking_space", "parking_entrance", "bench", "waste_basket", "post_box", "telephone", "recycling",
    "bicycle_parking", "vending_machine", "atm", "charging_station", "bicycle_rental", "motorcycle_parking", "shelter",
    "drinking_water", "toilets", "letter_box", "grit_bin", "clock", "fountain", "taxi", "car_sharing"],
  leisure: ["pitch", "playground", "swimming_pool", "garden", "picnic_table", "fitness_station", "slipway", "track"],
  public_transport: ["platform", "stop_position"],
  railway: ["platform", "level_crossing", "switch", "signal", "crossing", "buffer_stop", "subway_entrance"],
};
const isIgnored = (t: Json) => Object.entries(IGNORED).some(([k, vals]) => t[k] && vals.includes(t[k]));

function categorise(t: Json): string {
  const a = t.amenity, tr = t.tourism, l = t.leisure;
  if (["hotel", "guest_house", "hostel", "motel", "apartment", "camp_site", "caravan_site", "chalet"].includes(tr)) return "accommodation";
  if (["pub", "bar", "biergarten", "nightclub"].includes(a)) return "pub";
  if (["restaurant", "cafe", "fast_food", "food_court", "ice_cream"].includes(a)) return "restaurant";
  if (t.healthcare || ["hospital", "clinic", "doctors", "dentist", "pharmacy", "veterinary"].includes(a)) return "healthcare";
  if (["park", "nature_reserve", "common", "golf_course", "marina"].includes(l) || ["viewpoint", "picnic_site"].includes(tr)) return "outdoor";
  if (["theatre", "cinema", "arts_centre", "events_venue", "conference_centre", "music_venue", "concert_hall"].includes(a)
    || ["museum", "gallery", "attraction", "zoo", "theme_park", "aquarium"].includes(tr)
    || ["stadium", "sports_centre", "bowling_alley", "escape_game", "dance"].includes(l)) return "event";
  if (["community_centre", "place_of_worship", "library", "townhall", "coworking_space", "social_facility", "courthouse",
    "university", "college", "school"].includes(a) || t.office) return "meeting";
  if (t.railway === "station" || t.public_transport === "station" || t.aeroway || ["bus_station", "ferry_terminal", "fuel"].includes(a)) return "travel";
  return "other";
}

function elementPoint(e: Json): LatLng | null {
  if (typeof e.lat === "number") return { lat: e.lat, lng: e.lon };
  if (e.center) return { lat: e.center.lat, lng: e.center.lon };
  return null;
}

const RESIDENTIAL_TYPES = new Set(["house", "residential", "apartments", "detached", "semidetached_house", "terrace",
  "bungalow", "dormitory", "yes", "postcode", "living_street", "unclassified", "service", "tertiary", "secondary",
  "primary", "footway", "path", "track", "road", "street"]);
const POI_CATEGORIES = new Set(["amenity", "tourism", "shop", "leisure", "healthcare", "office", "railway", "aeroway", "historic", "club", "craft", "sport"]);

function areaLabel(addr: Json | undefined): string | null {
  if (!addr) return null;
  const local = addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? addr.city_district ?? addr.hamlet ?? addr.village;
  const city = addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.county;
  const parts = [local, city].filter((x, i, a) => x && a.indexOf(x) === i);
  return parts.length ? parts.join(", ") : null;
}

const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
const similarName = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

// ------------------------------------------------------------------- main
interface VisitRow { id: string; started_at: string; ended_at: string; lat: number; lng: number; venue_id: string | null; source: string }
interface Cluster { lat: number; lng: number; visits: VisitRow[]; home: boolean; zone: boolean }

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const now = Date.now();

  // Google semantic types by start time (all segments, incl. nested).
  const homeStarts = new Set<number>();
  const workStarts = new Set<number>();
  if (existsSync(TIMELINE)) {
    const data = JSON.parse(readFileSync(TIMELINE, "utf8")) as Json;
    for (const s of (data.semanticSegments ?? []) as Json[]) {
      const t = s.visit?.topCandidate?.semanticType;
      if (!t) continue;
      const ms = Date.parse(s.startTime);
      if (t === "HOME" || t === "INFERRED_HOME") homeStarts.add(ms);
      if (t === "WORK" || t === "INFERRED_WORK") workStarts.add(ms);
    }
  } else console.warn(`warning: ${TIMELINE} not found, HOME detection relies on hidden zones only`);

  const { data: rules, error: rErr } = await sb.from("publication_rules").select("rule_type, configuration").eq("rule_type", "exclusion_zone");
  if (rErr) throw rErr;
  const zones = (rules ?? []).map((r) => r.configuration as { lat: number; lng: number; radius_m: number }).filter((z) => typeof z?.lat === "number");
  const inZone = (p: LatLng, pad = 0) => zones.some((z) => haversineMeters(p, z) <= (z.radius_m ?? 0) + pad);

  const visits = await fetchAll<VisitRow>((f, t) =>
    sb.from("visits").select("id, started_at, ended_at, lat, lng, venue_id, source").order("started_at").range(f, t));
  const isHomeVisit = (v: VisitRow) => homeStarts.has(Date.parse(v.started_at));

  // Leader clustering with running centroid (sorted by latitude for locality).
  const clusters: Cluster[] = [];
  for (const v of [...visits].sort((a, b) => a.lat - b.lat)) {
    let best: Cluster | null = null, bestD = Infinity;
    for (let i = clusters.length - 1; i >= 0; i--) {
      const c = clusters[i];
      if (v.lat - c.lat > 0.001) break; // ~110 m further south: no candidates beyond
      const d = haversineMeters(v, c);
      if (d <= CLUSTER_M && d < bestD) { best = c; bestD = d; }
    }
    if (!best) { best = { lat: v.lat, lng: v.lng, visits: [], home: false, zone: false }; clusters.push(best); clusters.sort((a, b) => a.lat - b.lat); }
    const n = best.visits.length;
    best.lat = (best.lat * n + v.lat) / (n + 1);
    best.lng = (best.lng * n + v.lng) / (n + 1);
    best.visits.push(v);
  }

  const stat = (c: Cluster) => {
    const recent = c.visits.filter((v) => now - Date.parse(v.started_at) <= RECENT_MS);
    const minutes = (vs: VisitRow[]) => Math.round(vs.reduce((s, v) => s + (Date.parse(v.ended_at) - Date.parse(v.started_at)), 0) / 60000);
    return {
      count: c.visits.length, recentCount: recent.length, minutes: minutes(c.visits), recentMinutes: minutes(recent),
      first: c.visits.map((v) => v.started_at).sort()[0], last: c.visits.map((v) => v.started_at).sort().at(-1)!,
      work: c.visits.some((v) => workStarts.has(Date.parse(v.started_at))),
    };
  };

  const skipped = { hiddenZone: 0, googleHome: 0, residential: 0, noMatch: 0, duplicateOsm: 0, visitsInSkippedHome: 0 };
  const eligible: Cluster[] = [];
  for (const c of clusters) {
    c.zone = inZone(c, CLUSTER_M);
    c.home = c.visits.some(isHomeVisit);
    if (c.zone) { skipped.hiddenZone++; skipped.visitsInSkippedHome += c.visits.length; continue; }
    if (c.home) { skipped.googleHome++; skipped.visitsInSkippedHome += c.visits.length; continue; }
    eligible.push(c);
  }
  eligible.sort((a, b) => {
    const sa = stat(a), sbb = stat(b);
    return sbb.recentCount - sa.recentCount || sbb.recentMinutes - sa.recentMinutes || sbb.count - sa.count;
  });

  console.log(JSON.stringify({ visits: visits.length, clusters: clusters.length, eligible: eligible.length,
    eligibleWith2PlusRecent: eligible.filter((c) => stat(c).recentCount >= 2).length }));

  const { data: existingVenues, error: vErr } = await sb.from("venues").select("id, name, category, lat, lng, metadata");
  if (vErr) throw vErr;
  const venues = (existingVenues ?? []) as { id: string; name: string; category: string; lat: number | null; lng: number | null; metadata: Json }[];

  interface Suggestion { name: string; category: string; osm: string; point: LatLng; distance: number; address: string | null; label: string | null; clusters: Cluster[] }
  const byOsm = new Map<string, Suggestion>();
  let lookups = 0;

  for (const c of eligible) {
    if (lookups >= MAX_LOOKUPS || byOsm.size >= MAX_SUGGESTIONS) break;
    lookups++;
    // Known venue already here? Reuse without a lookup.
    let found: { name: string; category: string; osm: string; point: LatLng; tags: Json } | null = null;

    const elements = ((await overpass(c)) ?? [])
      .filter((e) => e.tags?.name && !isIgnored(e.tags))
      .map((e) => ({ e, p: elementPoint(e) }))
      .filter((x): x is { e: Json; p: LatLng } => !!x.p)
      .map((x) => ({ ...x, d: haversineMeters(c, x.p) }))
      .filter((x) => x.d <= LOOKUP_RADIUS_M)
      .sort((a, b) => a.d - b.d);
    if (elements.length) {
      const { e, p } = elements[0];
      found = { name: e.tags.name, category: categorise(e.tags), osm: `${e.type}/${e.id}`, point: p, tags: e.tags };
    } else {
      const rev = await nominatimReverse(c);
      const named = rev?.name && POI_CATEGORIES.has(rev.category) && !RESIDENTIAL_TYPES.has(rev.type) && !isIgnored({ [rev.category]: rev.type });
      if (named) {
        found = { name: rev.name, category: categorise({ [rev.category]: rev.type }), osm: `${rev.osm_type}/${rev.osm_id}`,
          point: { lat: Number(rev.lat), lng: Number(rev.lon) }, tags: {} };
      } else if (!rev || rev.error || ["building", "place", "highway", "landuse", "boundary"].includes(rev.category) || RESIDENTIAL_TYPES.has(rev.type)) {
        skipped.residential++;
        continue;
      } else {
        skipped.noMatch++;
        continue;
      }
    }
    const existing = byOsm.get(found.osm);
    if (existing) { existing.clusters.push(c); skipped.duplicateOsm++; continue; }
    const look = await nominatimLookup(found.osm);
    byOsm.set(found.osm, {
      name: found.name, category: found.category, osm: found.osm, point: found.point,
      distance: Math.round(haversineMeters(c, found.point)),
      address: look?.display_name ?? null, label: areaLabel(look?.address), clusters: [c],
    });
  }

  // ------------------------------------------------------------- write
  const table: Record<string, unknown>[] = [];
  let linkedTotal = 0;
  for (const s of byOsm.values()) {
    const vs = s.clusters.flatMap((c) => c.visits);
    const st = stat({ lat: 0, lng: 0, visits: vs, home: false, zone: false });
    const metadata = { suggested: true, status: "pending", source: "agent", osm: s.osm, visit_count: st.count,
      total_minutes: st.minutes, last_visit: new Date(st.last).toISOString(), match_distance_m: s.distance };

    const reuse = venues.find((v) => v.metadata?.osm === s.osm)
      ?? venues.find((v) => v.lat != null && haversineMeters(s.point, { lat: v.lat, lng: v.lng! }) <= LINK_M && similarName(v.name, s.name));
    let venueId = reuse?.id ?? null;
    let action = reuse ? "reused" : "created";
    if (!DRY) {
      if (!reuse) {
        const { data, error } = await sb.from("venues").insert({ name: s.name, category: s.category, address: s.address, lat: s.point.lat,
          lng: s.point.lng, public_area_label: s.label, is_public: false, metadata }).select("id").single();
        if (error) throw error;
        venueId = data.id;
        venues.push({ id: data.id, name: s.name, category: s.category, lat: s.point.lat, lng: s.point.lng, metadata });
      } else if (reuse.metadata?.source === "agent" && reuse.metadata?.status === "pending") {
        // Refresh stats of our own still-pending suggestion; never touch owner venues or the owner's decision.
        const { error } = await sb.from("venues").update({ metadata: { ...reuse.metadata, ...metadata }, updated_at: new Date().toISOString() }).eq("id", reuse.id);
        if (error) throw error;
        action = "refreshed";
      }
    }
    const venueCategory = reuse?.category ?? s.category;
    const anchor = reuse?.lat != null ? { lat: reuse.lat, lng: reuse.lng! } : s.point;

    // Link visits near the venue (or in its clusters), never stealing from another venue.
    const toLink = visits.filter((v) =>
      (v.venue_id === null || v.venue_id === venueId) && !isHomeVisit(v) && !inZone(v) &&
      haversineMeters(v, anchor) <= LINK_M);
    if (!DRY && venueId && toLink.length) {
      for (let i = 0; i < toLink.length; i += 200) {
        const { error } = await sb.from("visits").update({ venue_id: venueId, category: venueCategory }).in("id", toLink.slice(i, i + 200).map((v) => v.id));
        if (error) throw error;
      }
      for (const v of toLink) v.venue_id = venueId;
    }
    linkedTotal += toLink.length;
    table.push({ name: s.name, category: venueCategory, action, visits: st.count, recent3y: st.recentCount,
      hours: Math.round(st.minutes / 6) / 10, last: st.last.slice(0, 10), distM: s.distance, area: s.label,
      googleWork: st.work, linked: toLink.length });
  }

  console.table(table);
  console.log(JSON.stringify({ dryRun: DRY, lookups, networkCalls, overpassFailures, suggestions: byOsm.size, skipped, visitsLinked: linkedTotal }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
