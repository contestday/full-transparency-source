import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { detectVisits, fillStationaryGaps, nextVisitsCursor, type ObsPoint } from "@/lib/visits";
import { buildPolicy, decide, type Candidate, type PublicationRuleRow } from "@/lib/publication";
import { haversineMeters } from "@/lib/geo";
import { reverseLabel } from "@/lib/geocode";
import { planNameForStay } from "@/lib/stay-plan-match";
import { loadMatchPlans, relabelRecentStays } from "@/lib/stay-plan-match-server";
import { getSystemState, setSystemState } from "@/lib/ingest";
import { notifyAdmins } from "@/lib/notify";
import { reconcilePlanOutcomes } from "@/lib/jobs/plan-outcomes";

const PAGE = 1000;
const MAX_ROWS_PER_RUN = 50_000;
const WINDOW_MS = 14 * 24 * 3600_000;

async function fetchPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  max = MAX_ROWS_PER_RUN,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

interface ObsRow {
  id: string;
  observed_at: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
}

/** Step 1: derive visits from observations, advancing a cursor window by window. */
export async function deriveVisits(supabase: SupabaseClient) {
  const cursorState = await getSystemState<{ cursor: string }>("visits_cursor");
  let windowStart: number;
  if (cursorState?.cursor) {
    windowStart = Date.parse(cursorState.cursor);
  } else {
    const { data: first } = await supabase
      .from("location_observations")
      .select("observed_at")
      .neq("source", "google_timeline")
      .order("observed_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!first) return { visits: 0, windowEnd: null };
    windowStart = Date.parse(first.observed_at);
  }
  // Nothing new to process yet (also stops the cursor running into the future).
  if (windowStart >= Date.now()) return { visits: 0, windowEnd: null };
  const windowEnd = Math.min(Date.now(), windowStart + WINDOW_MS);

  const rows = await fetchPaged<ObsRow>((from, to) =>
    supabase
      .from("location_observations")
      .select("id, observed_at, lat, lng, accuracy_m")
      .eq("validation_status", "valid")
      // Google Timeline imports bring their own visits (scripts/backfill-google-visits.ts).
      .neq("source", "google_timeline")
      .gte("observed_at", new Date(windowStart).toISOString())
      .lte("observed_at", new Date(windowEnd).toISOString())
      .order("observed_at", { ascending: true })
      .range(from, to),
  );
  const points: ObsPoint[] = rows.map((r) => ({
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    t: Date.parse(r.observed_at),
    accuracyM: r.accuracy_m,
  }));
  // Live runs: silence after the latest reading means "still there" until now.
  const live = windowEnd >= Date.now() - 60_000;
  const visits = detectVisits(fillStationaryGaps(points, live ? windowEnd : (points.at(-1)?.t ?? windowEnd)));

  const [{ data: venues }, { data: plans }] = await Promise.all([
    supabase.from("venues").select("id, category, lat, lng, public_area_label").not("lat", "is", null),
    supabase
      .from("planned_activities")
      .select("id, starts_at, ends_at, lat, lng, venue_id")
      .lte("starts_at", new Date(windowEnd).toISOString())
      .gte("starts_at", new Date(windowStart - 7 * 24 * 3600_000).toISOString()),
  ]);
  const venueById = new Map((venues ?? []).map((v) => [v.id, v]));

  const upserts = visits.map((v) => {
    const nearestVenue = (venues ?? [])
      .map((ven) => ({ ven, d: haversineMeters(v, { lat: ven.lat!, lng: ven.lng! }) }))
      .filter((x) => x.d <= 75)
      .sort((a, b) => a.d - b.d)[0]?.ven;
    // Link to a planned activity only when time overlaps AND position is near it.
    const plan = (plans ?? []).find((p) => {
      const ps = Date.parse(p.starts_at);
      const pe = p.ends_at ? Date.parse(p.ends_at) : ps + 24 * 3600_000;
      if (v.endedAt < ps || v.startedAt > pe) return false;
      const ven = p.venue_id ? venueById.get(p.venue_id) : null;
      const loc = ven?.lat != null ? { lat: ven.lat, lng: ven.lng! } : p.lat != null ? { lat: p.lat, lng: p.lng! } : null;
      return loc ? haversineMeters(v, loc) <= 300 : false;
    });
    return {
      source: "derived",
      started_at: new Date(v.startedAt).toISOString(),
      ended_at: new Date(v.endedAt).toISOString(),
      lat: v.lat,
      lng: v.lng,
      radius_m: v.radiusM,
      observation_count: v.count,
      confidence: v.confidence,
      venue_id: nearestVenue?.id ?? null,
      category: nearestVenue?.category ?? null,
      planned_activity_id: plan?.id ?? null,
    };
  });
  if (upserts.length) {
    const { error } = await supabase.from("visits").upsert(upserts, { onConflict: "source,started_at" });
    if (error) throw error;
  }

  // A stay inferred from silence can be disproved by points FollowMee uploads
  // late. Remove derived stays in this window that are no longer detected,
  // withdrawing anything already published from them.
  const keep = new Set(upserts.map((u) => u.started_at));
  const { data: existing, error: exErr } = await supabase
    .from("visits")
    .select("id, started_at")
    .eq("source", "derived")
    .gte("started_at", new Date(windowStart).toISOString())
    .lte("started_at", new Date(windowEnd).toISOString());
  if (exErr) throw exErr;
  const gone = (existing ?? []).filter((v) => !keep.has(new Date(v.started_at).toISOString())).map((v) => v.id as string);
  if (gone.length) {
    const { error: wErr } = await supabase
      .from("published_locations")
      .update({ visibility_status: "withdrawn", withdrawn_at: new Date().toISOString(), withdrawn_reason: "superseded by later GPS points" })
      .in("source_visit_id", gone);
    if (wErr) throw wErr;
    const { error: dErr } = await supabase.from("visits").delete().in("id", gone);
    if (dErr) throw dErr;
  }

  // Next window begins at the start of the last visit (so an in-progress stay is
  // re-detected with the same started_at), or 6 h before window end.
  const lastVisit = visits.at(-1);
  const nextStart =
    lastVisit && lastVisit.endedAt > windowEnd - 6 * 3600_000 ? lastVisit.startedAt : windowEnd - 6 * 3600_000;
  await setSystemState("visits_cursor", { cursor: new Date(nextVisitsCursor(windowStart, windowEnd, nextStart, Date.now())).toISOString() });
  return { visits: upserts.length, windowEnd: new Date(windowEnd).toISOString() };
}

/** Step 2: publish eligible visits (and optional track samples) under the policy. */
export async function publish(supabase: SupabaseClient) {
  const { data: ruleRows, error } = await supabase
    .from("publication_rules")
    .select("rule_type, configuration, enabled");
  if (error) throw error;
  const policy = buildPolicy((ruleRows ?? []) as PublicationRuleRow[]);
  if (policy.paused) return { published: 0, skipped: {}, status: "paused" as const };
  if (!policy.exclusionZones.length) return { published: 0, skipped: {}, status: "no_exclusion_zones" as const };

  await relabelRecentStays(supabase).catch((err) => console.error("plan names for stops failed", err));
  const cutoff = new Date(Date.now() - policy.delayHours * 3600_000).toISOString();
  const cursorState = await getSystemState<{ cursor: string }>("publish_cursor");
  const since = cursorState?.cursor ?? "1970-01-01T00:00:00Z";

  const visits = await fetchPaged<{
    id: string;
    started_at: string;
    ended_at: string;
    lat: number;
    lng: number;
    radius_m: number | null;
    category: string | null;
    venue_id: string | null;
  }>((from, to) =>
    supabase
      .from("visits")
      .select("id, started_at, ended_at, lat, lng, radius_m, category, venue_id")
      .gt("ended_at", since)
      .lte("ended_at", cutoff)
      .order("ended_at", { ascending: true })
      .range(from, to),
  );

  const { data: venues } = await supabase.from("venues").select("id, name, public_area_label, is_public, lat, lng");
  const venueById = new Map((venues ?? []).map((v) => [v.id as string, v]));

  const candidates: Candidate[] = visits.map((v) => ({
    key: `visit:${v.id}`,
    kind: "visit",
    visitId: v.id,
    lat: v.lat,
    lng: v.lng,
    radiusM: v.radius_m ?? 0,
    category: v.category,
    observedAt: v.started_at,
    observedUntil: v.ended_at,
    areaLabelHint: v.venue_id ? (venueById.get(v.venue_id)?.public_area_label as string | null) ?? null : null,
    publicVenue: (() => {
      const ven = v.venue_id ? venueById.get(v.venue_id) : null;
      return ven?.is_public && ven.lat != null && ven.lng != null ? { lat: ven.lat, lng: ven.lng, name: ven.name } : null;
    })(),
  }));

  if (policy.publishTracks) {
    const obs = await fetchPaged<ObsRow>((from, to) =>
      supabase
        .from("location_observations")
        .select("id, observed_at, lat, lng, accuracy_m")
        .eq("validation_status", "valid")
        .gt("observed_at", since)
        .lte("observed_at", cutoff)
        .order("observed_at", { ascending: true })
        .range(from, to),
    );
    const bucketMs = policy.trackIntervalMinutes * 60_000;
    const seen = new Set<number>();
    for (const o of obs) {
      if (o.accuracy_m !== null && o.accuracy_m > 200) continue;
      const bucket = Math.floor(Date.parse(o.observed_at) / bucketMs) * bucketMs;
      if (seen.has(bucket)) continue;
      seen.add(bucket);
      candidates.push({
        key: `track:${bucket}`,
        kind: "track",
        lat: o.lat,
        lng: o.lng,
        observedAt: new Date(bucket).toISOString(),
      });
    }
  }

  const skipped: Record<string, number> = {};
  const records = [];
  for (const c of candidates) {
    const d = decide(c, policy);
    if (d.publish) records.push(d.record);
    else skipped[d.reason] = (skipped[d.reason] ?? 0) + 1;
  }
  // A stay during one of my published plans, within 800 m of the place I
  // said, is named after that plan's place (I was where I said I'd be).
  const stays = records.filter((r) => r.kind === "visit" && !r.venue_name);
  if (stays.length) {
    const fromIso = stays.reduce((m, r) => (r.observed_at < m ? r.observed_at : m), stays[0].observed_at);
    const toIso = stays.reduce((m, r) => ((r.observed_until ?? r.observed_at) > m ? (r.observed_until ?? r.observed_at) : m), stays[0].observed_at);
    const plans = await loadMatchPlans(supabase, fromIso, toIso);
    for (const rec of stays) {
      const name = planNameForStay({ lat: rec.public_lat, lng: rec.public_lng, from: rec.observed_at, until: rec.observed_until ?? null }, plans);
      if (name) rec.venue_name = name;
    }
  }
  // Exact mode: give stays that aren't at a known venue a place name (street
  // and district, or a public place's name). Nominatim allows 1 request/s,
  // so a few per run; scripts/republish-exact.ts labels any backlog.
  if (policy.gridM === 0) {
    let lookups = 0;
    for (const rec of records) {
      if (rec.kind !== "visit" || rec.venue_name || rec.area_label || lookups >= 8) continue;
      if (lookups++) await new Promise((r) => setTimeout(r, 1100));
      rec.area_label = await reverseLabel(rec.public_lat, rec.public_lng);
    }
  }

  let published = 0;
  for (let i = 0; i < records.length; i += PAGE) {
    const { data, error: upErr } = await supabase
      .from("published_locations")
      // ignoreDuplicates: never resurrect a withdrawn record
      .upsert(records.slice(i, i + PAGE), { onConflict: "source_key", ignoreDuplicates: true })
      .select("id");
    if (upErr) throw upErr;
    published += data?.length ?? 0;
  }
  // With a short delay a stay can be published while it is still going on.
  // Keep the end time of recent, still-published stays up to date (withdrawn
  // records are left alone).
  const recentCutoff = Date.now() - 48 * 3600_000;
  for (const rec of records) {
    if (rec.kind !== "visit" || !rec.observed_until || Date.parse(rec.observed_until) < recentCutoff) continue;
    const { error: updErr } = await supabase
      .from("published_locations")
      .update({ observed_until: rec.observed_until })
      .eq("source_key", rec.source_key)
      .eq("visibility_status", "published");
    if (updErr) throw updErr;
  }
  const lastEnded = visits.at(-1)?.ended_at;
  const reachedEnd = visits.length < MAX_ROWS_PER_RUN;
  await setSystemState("publish_cursor", { cursor: reachedEnd ? cutoff : lastEnded ?? cutoff });
  await setSystemState("publish_last_run", { at: new Date().toISOString(), published, skipped });
  return { published, skipped, status: "ok" as const };
}

export async function processPublication() {
  const supabase = createServiceClient();
  // The anonymous journey log is kept for 30 days only.
  await supabase
    .from("site_events")
    .delete()
    .lt("at", new Date(Date.now() - 30 * 86_400_000).toISOString())
    .then(({ error }) => error && console.error("journey log clean-up failed", error.message));
  // Watchers' alert history (for the popup) is kept for 30 days too.
  await supabase
    .from("watcher_alerts")
    .delete()
    .lt("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
    .then(({ error }) => error && console.error("alert history clean-up failed", error.message));
  try {
    const derived = await deriveVisits(supabase);
    const published = await publish(supabase);
    // Plan outcomes use the stays just derived; a failure here must not block publication.
    const plans = await reconcilePlanOutcomes(supabase).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    return { derived, published, plans };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await notifyAdmins({
      event: "publication_failure",
      title: "Publication processing failed",
      body: message.slice(0, 180),
      url: "/admin/settings",
    });
    throw err;
  }
}
