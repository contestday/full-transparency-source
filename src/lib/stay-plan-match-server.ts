import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planNameForStay, type MatchPlan } from "@/lib/stay-plan-match";

/**
 * Published, not-cancelled plans between two times, with the public name the
 * plan already shows and its private point (for distance only).
 */
export async function loadMatchPlans(supabase: SupabaseClient, fromIso: string, toIso: string): Promise<MatchPlan[]> {
  const from = new Date(Date.parse(fromIso) - 2 * 86_400_000).toISOString();
  const { data: pub } = await supabase
    .from("public_plans")
    .select("id, starts_at, ends_at, all_day, status, venue_name, public_area_label")
    .gte("starts_at", from)
    .lte("starts_at", toIso)
    .neq("status", "cancelled");
  const rows = (pub ?? []) as { id: string; starts_at: string; ends_at: string | null; all_day: boolean; venue_name: string | null; public_area_label: string | null }[];
  if (!rows.length) return [];
  const { data: priv } = await supabase
    .from("planned_activities")
    .select("id, lat, lng, venue:venues(lat, lng)")
    .in("id", rows.map((r) => r.id));
  const pointOf = new Map(
    ((priv ?? []) as unknown as { id: string; lat: number | null; lng: number | null; venue: { lat: number | null; lng: number | null } | null }[]).map((p) => {
      const lat = p.venue?.lat ?? p.lat;
      const lng = p.venue?.lng ?? p.lng;
      return [p.id, lat != null && lng != null ? { lat, lng } : null];
    }),
  );
  return rows.map((r) => ({
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    all_day: r.all_day,
    point: pointOf.get(r.id) ?? null,
    name: r.venue_name ?? r.public_area_label,
  }));
}

/**
 * Re-check published stops from the last `days` days that have no venue
 * name: a plan added or edited later still names them. Returns how many changed.
 */
export async function relabelRecentStays(supabase: SupabaseClient, days = 14): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabase
    .from("published_locations")
    .select("id, public_lat, public_lng, observed_at, observed_until")
    .eq("kind", "visit")
    .eq("visibility_status", "published")
    .is("venue_name", null)
    .gte("observed_at", since)
    .limit(2000);
  const stays = (data ?? []) as { id: string; public_lat: number; public_lng: number; observed_at: string; observed_until: string | null }[];
  if (!stays.length) return 0;
  const plans = await loadMatchPlans(supabase, since, new Date().toISOString());
  let changed = 0;
  for (const s of stays) {
    const name = planNameForStay({ lat: s.public_lat, lng: s.public_lng, from: s.observed_at, until: s.observed_until }, plans);
    if (!name) continue;
    const { error } = await supabase.from("published_locations").update({ venue_name: name }).eq("id", s.id);
    if (!error) changed++;
  }
  return changed;
}
