import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LiveStatus } from "@/lib/live-status";
import { loadSampleWatcher } from "@/lib/sample-watcher";
import { loadWatchAreas } from "@/lib/watch-areas";
import { loadHomeArea } from "@/lib/home";

/** One area on the private maps, with what kind it is and whose. */
export interface MapFence {
  id: string;
  reference: string;
  geojson: { type: "Polygon"; coordinates: [number, number][][] } | { type: "MultiPolygon"; coordinates: [number, number][][][] };
  /** mine = my own areas; wish / want = watchers' areas; location = the public sample's Locations. */
  group: "mine" | "wish" | "want" | "location" | "event";
  /** Wish areas: "outside" = amber when I'm outside it. */
  outside: boolean;
  sample: boolean;
  name: string;
  verification_status: string;
  origin: string;
  status: string;
  currently_inside: boolean;
  description: string | null;
}

/** Geofences and located plans shown as overlays on private maps. */
export async function loadMapContext(supabase: SupabaseClient) {
  const [{ data: geofences }, { data: plans }, { data: live }, sample, homeArea] = await Promise.all([
    supabase
      .from("geofences_geojson")
      .select("id, reference, geojson, verification_status, origin, status, currently_inside, description, tier, wide_mode, shape_type, watcher_id")
      .eq("status", "active"),
    supabase
      .from("planned_activities")
      .select("id, title, starts_at, lat, lng, venue:venues(lat, lng)")
      .eq("archived", false)
      .gte("starts_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .limit(200),
    supabase.from("live_status").select("status").eq("id", 1).maybeSingle(),
    loadSampleWatcher().catch(() => null),
    loadHomeArea().catch(() => null),
  ]);
  const planPoints = (plans ?? []).flatMap((p) => {
    const venue = p.venue as unknown as { lat: number | null; lng: number | null } | null;
    const lat = venue?.lat ?? p.lat;
    const lng = venue?.lng ?? p.lng;
    return lat != null && lng != null ? [{ id: p.id, title: p.title, starts_at: p.starts_at, lat, lng }] : [];
  });

  type Row = { id: string; reference: string; geojson: MapFence["geojson"]; verification_status: string; origin: string; status: string; currently_inside: boolean; description: string | null; tier: string | null; wide_mode: string | null; shape_type: string; watcher_id: string | null };
  const fences: MapFence[] = ((geofences ?? []) as Row[]).flatMap((g) => {
    if (!g.geojson) return [];
    const group: MapFence["group"] = g.origin === "admin" || !g.tier ? "mine" : g.tier === "local" ? "want" : "wish";
    return [
      {
        id: g.id,
        reference: g.reference,
        geojson: g.geojson,
        group,
        outside: g.shape_type === "beyond_home" || g.wide_mode === "outside",
        sample: Boolean(sample && g.watcher_id === sample.watcherId),
        name: (g.description ?? "").split("\n")[0],
        verification_status: g.verification_status,
        origin: g.origin,
        status: g.status,
        currently_inside: g.currently_inside,
        description: g.description,
      },
    ];
  });

  // The public sample's Locations: anyone can see them at /sample, so they're
  // shown here too. Real watchers' Locations stay private to them.
  if (sample) {
    const areas = await loadWatchAreas(sample.watcherId, sample.token).catch(() => []);
    for (const a of areas) {
      if (a.tier !== "location") continue;
      fences.push({
        id: a.id,
        reference: a.reference,
        geojson: a.geometry as MapFence["geojson"],
        group: "location",
        outside: false,
        sample: true,
        name: a.name,
        verification_status: "verified",
        origin: "anonymous",
        status: "active",
        currently_inside: false,
        description: a.name,
      });
    }
  }
  // Watchers' events that are on now or coming up (black; dashed until they're on).
  const { loadAllEvents } = await import("@/lib/events/server");
  for (const e of await loadAllEvents().catch(() => [])) {
    if (e.phase !== "on" && e.phase !== "upcoming") continue;
    for (const p of e.places) {
      fences.push({
        id: p.id ?? `${e.id}-${p.position}`,
        reference: e.reference,
        geojson: p.geojson as MapFence["geojson"],
        // My own bans sit with my own areas (shown to everyone); watchers' events are black.
        group: e.is_owner ? "mine" : "event",
        outside: false,
        sample: false,
        name: `${e.is_owner ? "Banned: " : ""}${e.title} · ${p.name}${e.phase === "on" ? " (on now)" : " (upcoming)"}`,
        verification_status: "verified",
        origin: "anonymous",
        status: "active",
        currently_inside: false,
        description: e.title,
      });
    }
  }
  return { geofences: fences, plans: planPoints, liveStatus: (live?.status as LiveStatus | undefined) ?? "unknown", homeArea };
}
