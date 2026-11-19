"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Overlay } from "@/components/overlay";
import type { MapFeature } from "@/components/map-lazy";
import type { PublicPlan } from "@/lib/public-data";
import { loadWatchLinks } from "@/lib/watch-links";
import { TIER_META, type Tier } from "@/lib/geofence/tiers";
import { PlansMap } from "./map/plans-map";

type Geo = MapFeature["geometry"];

/**
 * Areas that matter to whoever is looking: the areas on this device's watch
 * link (solid) and, when signed in as staff, every active area (mine dashed).
 */
async function viewerAreas(): Promise<{ features: MapFeature[]; note: string | null }> {
  const features: MapFeature[] = [];
  const notes: string[] = [];
  const token = loadWatchLinks()[0]?.token;
  if (token) {
    const v = await fetch(`/api/watch/${token}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    for (const a of (v?.areas ?? []) as { tier: Tier; name: string; geojson: Geo | null }[]) {
      if (a.geojson) features.push({ type: "Feature", geometry: a.geojson, properties: { color: TIER_META[a.tier].color, opacity: 0.14, label: `Your ${TIER_META[a.tier].label} area${a.name ? `: ${a.name}` : ""}` } });
    }
    if (features.length) notes.push("your areas");
  }
  const me = await fetch("/api/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (me?.staff) {
    const g = await fetch("/api/admin/geofences", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    for (const a of (g?.geofences ?? []) as { geojson: Geo | null; origin: string; tier: Tier | null; description: string | null }[]) {
      if (!a.geojson) continue;
      const mine = a.origin === "admin" || !a.tier;
      features.push({
        type: "Feature",
        geometry: a.geojson,
        properties: { color: mine ? "#142B49" : TIER_META[a.tier!].color, opacity: 0.08, dashed: mine, label: mine ? `My noted area${a.description ? `: ${a.description.split("\n")[0]}` : ""}` : `A watcher's ${TIER_META[a.tier!].label} area` },
      });
    }
    notes.push("all areas (staff view; mine dashed)");
  }
  return { features, note: notes.length ? `Also shown: ${notes.join(" and ")}.` : null };
}

/** Opens a map of one plan's place(s) over the page, with the areas that matter to the viewer. */
export function PlanMapButton({ plan, className, children }: { plan: PublicPlan; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [areas, setAreas] = useState<{ features: MapFeature[]; note: string | null } | null>(null);
  useEffect(() => {
    if (!open || areas) return;
    let live = true;
    viewerAreas().then((a) => live && setAreas(a));
    return () => {
      live = false;
    };
  }, [open, areas]);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {children}
      </button>
      {open && (
        <Overlay title={plan.title} onClose={() => setOpen(false)} wide>
          <PlansMap plans={[plan]} context={areas?.features} className="h-[60vh] min-h-72 w-full" />
          <p className="mt-2 text-xs text-muted">
            Tap the marker for details. Some places are shown only as a general area.{areas?.note ? ` ${areas.note}` : ""}
          </p>
        </Overlay>
      )}
    </>
  );
}
