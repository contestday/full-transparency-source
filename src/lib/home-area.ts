// The home area on maps (shared by public, watcher and admin maps). Pure.
//
// Everyone may see where the home area is; movement inside it is never shown.
// When I'm inside it, the live marker has no position, so a large marker in the
// home area shows that I'm there (rather than looking offline).

import type { Feature, Geometry } from "geojson";
import { circleRing } from "@/lib/geo";

export interface HomeAreaShape {
  lat: number;
  lng: number;
  radius_m: number;
}

type Props = { color?: string; label?: string; dashed?: boolean; size?: number; opacity?: number };

export const HOME_AREA_COLOR = "#007B60";
export const HOME_AREA_LABEL = "My home area\nMovement inside it is never shown.";

/** Live statuses that mean "I'm somewhere with a current reading". */
const LIVE = new Set(["green", "yellow", "amber", "red", "purple"]);

/** Inside the home area: a current status but no public position. */
export function atHome(status: string, publicLat: number | null | undefined): boolean {
  return LIVE.has(status) && publicLat == null;
}

export function homeAreaFeatures(home: HomeAreaShape | null | undefined, opts: { here?: boolean; color?: string; hereLabel?: string } = {}): Feature<Geometry, Props>[] {
  if (!home) return [];
  const out: Feature<Geometry, Props>[] = [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [circleRing(home, home.radius_m, 64)] },
      // My own area: dashed outline (watchers' areas are solid).
      properties: { color: HOME_AREA_COLOR, opacity: opts.here ? 0.22 : 0.1, dashed: true, label: HOME_AREA_LABEL },
    },
  ];
  if (opts.here) {
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [home.lng, home.lat] },
      properties: { color: opts.color ?? HOME_AREA_COLOR, size: 16, label: opts.hereLabel ?? "In my home area now\nMovement inside it is never shown." },
    });
  }
  return out;
}
