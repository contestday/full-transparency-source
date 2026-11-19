import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/** The private home point (Settings → Live marker). Server-side only: never sent to visitors. */
export async function loadHome(): Promise<{ lat: number; lng: number } | null> {
  const { data } = await createServiceClient()
    .from("publication_rules")
    .select("configuration, enabled")
    .eq("rule_type", "home_range")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = (data?.configuration ?? {}) as { lat?: unknown; lng?: unknown };
  const lat = Number(c.lat);
  const lng = Number(c.lng);
  return data?.enabled && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** The okay zone (home circle): green inside, yellow outside. Server-side only. */
export async function loadOkayZone(): Promise<{ lat: number; lng: number; radiusM: number } | null> {
  const { data } = await createServiceClient()
    .from("publication_rules")
    .select("configuration, enabled")
    .eq("rule_type", "home_range")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = (data?.configuration ?? {}) as { lat?: unknown; lng?: unknown; radius_m?: unknown };
  const lat = Number(c.lat);
  const lng = Number(c.lng);
  const radiusM = Number(c.radius_m);
  return data?.enabled && Number.isFinite(lat) && Number.isFinite(lng) && radiusM > 0 ? { lat, lng, radiusM } : null;
}

/** The home area shown on maps: the hidden zone around home, plus half a public square. */
export interface HomeArea {
  lat: number;
  lng: number;
  radius_m: number;
}

/**
 * Where nothing is ever published: the hidden zone around home, widened by half
 * a public square's diagonal (as the live marker does). Everyone may see where
 * the area is; movement inside it is never shown.
 */
export async function loadHomeArea(): Promise<HomeArea | null> {
  const { data } = await createServiceClient().from("publication_rules").select("rule_type, configuration, enabled").in("rule_type", ["exclusion_zone", "live_status"]).eq("enabled", true);
  const rows = (data ?? []) as { rule_type: string; configuration: Record<string, unknown> }[];
  const home = rows.find((r) => r.rule_type === "exclusion_zone" && r.configuration.label === "Home");
  const lat = Number(home?.configuration.lat);
  const lng = Number(home?.configuration.lng);
  const hidden = Number(home?.configuration.radius_m);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !(hidden > 0)) return null;
  const grid = Number(rows.find((r) => r.rule_type === "live_status")?.configuration.grid_m ?? 250);
  return { lat, lng, radius_m: Math.round(hidden + ((Number.isFinite(grid) ? grid : 250) * Math.SQRT2) / 2) };
}
