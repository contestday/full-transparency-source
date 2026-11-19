"use client";

import { useMemo } from "react";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { gridCellRing } from "@/lib/geo";
import { categoryLabel, STATUS_LABELS, type PlanStatus } from "@/lib/plans";
import type { PublicPlan } from "@/lib/public-data";
import { fmtDate } from "@/lib/format";

/** `context`: areas drawn underneath (e.g. the viewer's own areas); the map still zooms to the plans. */
export function PlansMap({ plans, className = "h-[65vh] min-h-80 w-full", context }: { plans: PublicPlan[]; className?: string; context?: MapFeature[] }) {
  const features = useMemo<MapFeature[]>(
    () =>
      plans.flatMap((p) => [p, ...p.extra_locations.filter((l) => l.public_lat != null).map((l) => ({ ...p, public_lat: l.public_lat, public_lng: l.public_lng, public_cell_size_m: l.public_cell_size_m, venue_name: l.venue_name, public_area_label: l.area_label }))]).filter((p) => p.public_lat != null).map((p) => {
        const label = [
          p.title,
          `${fmtDate(p.starts_at)}${p.ends_at && fmtDate(p.ends_at) !== fmtDate(p.starts_at) ? ` – ${fmtDate(p.ends_at)}` : ""}`,
          `${categoryLabel(p.category)} · ${STATUS_LABELS[p.status as PlanStatus] ?? p.status}`,
          p.venue_name ?? (p.public_area_label ? `${p.public_area_label} (general area)` : "General area"),
        ].join("\n");
        const color = p.status === "cancelled" ? "#94a3b8" : "#1d4ed8";
        if (p.public_cell_size_m) {
          return {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [gridCellRing({ lat: p.public_lat!, lng: p.public_lng! }, p.public_cell_size_m)],
            },
            properties: { label, color, dashed: true },
          } satisfies MapFeature;
        }
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.public_lng!, p.public_lat!] },
          properties: { label, color },
        } satisfies MapFeature;
      }),
    [plans],
  );
  const all = useMemo(() => (context?.length ? [...context, ...features] : features), [context, features]);
  const focus = useMemo(() => (context?.length ? { key: 1, features } : null), [context, features]);
  return <LazyMap features={all} fit={context?.length ? false : true} focus={focus} className={className} ariaLabel="Plans map" />;
}
