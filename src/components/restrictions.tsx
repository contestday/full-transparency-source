"use client";

import { useEffect, useState } from "react";
import type { MapFeature } from "@/components/map-lazy";
import type { EventView } from "@/components/event-card";
import type { AreaGeometry } from "@/lib/geofence/area-geometry";
import { PHASE_LABEL } from "@/lib/events/rules";

/** Red: where I mustn't go (shown to everyone). */
export const RESTRICTION_COLOR = "#C62828";

export interface Restrictions {
  owner_first: string;
  areas: { reference: string; name: string; geojson: AreaGeometry }[];
  events: EventView[];
}

let cache: Promise<Restrictions | null> | null = null;
function loadRestrictions(): Promise<Restrictions | null> {
  cache ??= fetch("/api/public/restrictions")
    .then((r) => (r.ok ? (r.json() as Promise<Restrictions>) : null))
    .catch(() => null);
  return cache;
}

/** My own areas and the events I'm banned from (public). Null until loaded. */
export function useRestrictions(): Restrictions | null {
  const [data, setData] = useState<Restrictions | null>(null);
  useEffect(() => {
    let live = true;
    loadRestrictions().then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, []);
  return data;
}

/** Map shapes for my restrictions: areas always; events while on (solid) or coming up (dashed). */
export function restrictionFeatures(r: Restrictions | null): MapFeature[] {
  if (!r) return [];
  const f: MapFeature[] = r.areas.map((a) => ({
    type: "Feature" as const,
    geometry: a.geojson,
    properties: { color: RESTRICTION_COLOR, opacity: 0.1, context: true, label: `Where I mustn't go${a.name ? `: ${a.name}` : ""}\nIf I'm in here, everyone sees red.` },
  }));
  for (const e of r.events) {
    if (e.phase !== "on" && e.phase !== "upcoming") continue;
    for (const p of e.places) {
      f.push({
        type: "Feature",
        geometry: p.geojson,
        properties: {
          color: RESTRICTION_COLOR,
          opacity: e.phase === "on" ? 0.16 : 0.05,
          dashed: e.phase !== "on",
          context: true,
          label: `I'm banned from here: ${e.title}\n${p.name} · ${PHASE_LABEL[e.phase]}`,
        },
      });
    }
  }
  return f;
}
