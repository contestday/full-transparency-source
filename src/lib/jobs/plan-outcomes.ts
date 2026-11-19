import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyAdmins } from "@/lib/notify";
import { fmtDate } from "@/lib/format";
import type { LatLng } from "@/lib/geo";
import {
  ASK_AFTER_END_MS,
  OPEN_PLAN_STATUSES,
  VERIFY_FOR_MS,
  gpsActualTimes,
  planEndMs,
} from "@/lib/plan-outcome";

interface PlanRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  status: string;
  lat: number | null;
  lng: number | null;
  venue_id: string | null;
  outcome_asked_at?: string | null;
  plan_locations?: { venue_id: string }[];
}

const missingColumn = (e: { message?: string } | null) => Boolean(e && /completion_source|outcome_asked_at|actual_(started|ended)_at/.test(e.message ?? ""));

/**
 * After a plan's time has passed: mark it completed if the GPS record shows I
 * was there, otherwise ask me (once) whether it happened. Plans I've answered
 * leave the open statuses and are not touched again.
 */
export async function reconcilePlanOutcomes(supabase: SupabaseClient, now = Date.now()) {
  const { data: plans, error } = await supabase
    .from("planned_activities")
    .select("*, plan_locations(venue_id)")
    .eq("archived", false)
    .in("status", [...OPEN_PLAN_STATUSES])
    .gte("starts_at", new Date(now - VERIFY_FOR_MS - 7 * 24 * 3600_000).toISOString())
    .lte("starts_at", new Date(now).toISOString());
  if (error) throw error;
  const due = ((plans ?? []) as PlanRow[]).filter((p) => planEndMs(p) < now && planEndMs(p) > now - VERIFY_FOR_MS);
  if (!due.length) return { completed: 0, asked: 0 };

  const venueIds = new Set<string>();
  for (const p of due) {
    if (p.venue_id) venueIds.add(p.venue_id);
    for (const l of p.plan_locations ?? []) venueIds.add(l.venue_id);
  }
  const { data: venues } = venueIds.size
    ? await supabase.from("venues").select("id, lat, lng").in("id", [...venueIds])
    : { data: [] as { id: string; lat: number | null; lng: number | null }[] };
  const venueAt = new Map((venues ?? []).filter((v) => v.lat != null && v.lng != null).map((v) => [v.id, { lat: v.lat!, lng: v.lng! }]));

  const from = Math.min(...due.map((p) => Date.parse(p.starts_at))) - 3600_000;
  const to = Math.max(...due.map((p) => planEndMs(p))) + 3600_000;
  const [{ data: obs }, { data: stays }] = await Promise.all([
    supabase
      .from("location_observations")
      .select("observed_at, lat, lng")
      .eq("validation_status", "valid")
      .gte("observed_at", new Date(from).toISOString())
      .lte("observed_at", new Date(to).toISOString())
      .limit(20_000),
    supabase
      .from("visits")
      .select("started_at, ended_at, lat, lng")
      .lte("started_at", new Date(to).toISOString())
      .gte("ended_at", new Date(from).toISOString())
      .limit(5_000),
  ]);
  const evidence = {
    points: (obs ?? []).map((o) => ({ lat: o.lat, lng: o.lng, t: Date.parse(o.observed_at) })),
    stays: (stays ?? []).map((s) => ({ lat: s.lat, lng: s.lng, start: Date.parse(s.started_at), end: Date.parse(s.ended_at) })),
  };

  let completed = 0;
  let asked = 0;
  for (const p of due) {
    const locations: LatLng[] = [];
    if (p.venue_id && venueAt.has(p.venue_id)) locations.push(venueAt.get(p.venue_id)!);
    if (p.lat != null && p.lng != null) locations.push({ lat: p.lat, lng: p.lng });
    for (const l of p.plan_locations ?? []) if (venueAt.has(l.venue_id)) locations.push(venueAt.get(l.venue_id)!);

    const actual = gpsActualTimes(p, locations, evidence);
    if (actual) {
      const stamp = new Date(now).toISOString();
      let { error: upErr } = await supabase
        .from("planned_activities")
        .update({
          status: "completed",
          completion_source: "gps",
          actual_started_at: new Date(actual.start).toISOString(),
          actual_ended_at: new Date(actual.end).toISOString(),
          updated_at: stamp,
        })
        .eq("id", p.id);
      if (missingColumn(upErr)) ({ error: upErr } = await supabase.from("planned_activities").update({ status: "completed", updated_at: stamp }).eq("id", p.id));
      if (upErr) throw upErr;
      completed++;
      continue;
    }

    if (p.outcome_asked_at || now - planEndMs(p) < ASK_AFTER_END_MS) continue;
    const { error: askErr } = await supabase.from("planned_activities").update({ outcome_asked_at: new Date(now).toISOString() }).eq("id", p.id);
    if (missingColumn(askErr)) continue; // migration 0010 not applied: the admin page still shows the question
    if (askErr) throw askErr;
    await notifyAdmins({
      event: "plan_outcome_needed",
      title: "Did this plan happen?",
      body: `"${p.title.slice(0, 80)}" (${fmtDate(p.starts_at)}): GPS didn't place me there. Confirm or cancel it.`,
      url: "/admin/plans",
    });
    asked++;
  }
  return { completed, asked };
}
