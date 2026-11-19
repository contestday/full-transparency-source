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
