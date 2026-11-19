"use client";

import { useMemo, useState } from "react";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { EmptyState, LegendItem, MapFrame } from "@/components/design";
import { cn } from "@/components/ui";
import { cardColour, onZone } from "@/components/zone-card";
import { gridCellRing } from "@/lib/geo";
import { categoryLabel } from "@/lib/plans";
import { BASE_ZONE_LABEL, WATCH_ZONE_LABEL, ZONE_COLOR, type BaseZone, type WatchZone, type Zone } from "@/lib/geofence/tiers";
import { fmtDate, fmtDateTime, fmtTime, londonDayKey } from "@/lib/format";
import type { PublicHistoryRecord } from "@/lib/public-data";
import { homeAreaFeatures, type HomeAreaShape } from "@/lib/home-area";

/** "1 h 20 min" between two times, or "" if unknown. */
function duration(from: string, to: string | null): string {
  if (!to) return "";
  const mins = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  if (!(mins > 0)) return "";
  const h = Math.floor(mins / 60);
  return h ? `${h} h${mins % 60 ? ` ${mins % 60} min` : ""}` : `${mins} min`;
}

/** A stay's name: the venue, the place/street name, or a plain fallback. */
const stayName = (r: { venue_name: string | null; area_label: string | null; cell_size_m: number }) =>
  r.venue_name ?? r.area_label ?? (r.cell_size_m ? "Approximate area" : "Stop");
const SELECTED = "#142B49";
const NEUTRAL = "#245AD6";

/**
 * Map and timeline of published movement. Public history: routes and stops
 * green / yellow / red as everyone sees them. Watched history: the same, plus
 * the watcher's own colours (route in their colours, a coloured frame around
 * stops in their areas).
 */
export function HistoryView({
  records,
  route,
  stopZones = {},
  watchZones,
  homeArea = null,
}: {
  /** My home area: shown on the map; movement inside it is never published. */
  homeArea?: HomeAreaShape | null;
  records: PublicHistoryRecord[];
  /** Route lines, coloured on the server. */
  route: { zone: Zone; coords: [number, number][] }[];
  /** Everyone's colour for each stop (by record id). */
  stopZones?: Record<string, BaseZone>;
  /** Watched history only: the watcher's colour for each stop. */
  watchZones?: Record<string, WatchZone | null>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const watched = Boolean(watchZones);
  const visits = useMemo(() => records.filter((r) => r.kind === "visit"), [records]);
  // Exact GPS publication (grid 0) vs older approximate squares.
  const exact = useMemo(() => records.some((r) => r.kind === "track" && r.cell_size_m === 0), [records]);
  const usedZones = useMemo(() => new Set(route.map((r) => r.zone)), [route]);

  const features = useMemo<MapFeature[]>(() => {
    const f: MapFeature[] = [...homeAreaFeatures(homeArea)];
    f.push(...route.map((r) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: r.coords },
      properties: { color: ZONE_COLOR[r.zone] },
    })) as MapFeature[]);
    visits.forEach((r, i) => {
      const on = r.id === selected;
      const wz = watchZones?.[r.id] ?? null;
      const bz = stopZones[r.id];
      const color = on ? SELECTED : wz ? ZONE_COLOR[wz] : bz ? ZONE_COLOR[bz] : NEUTRAL;
      const label = [
        `${i + 1}. ${stayName(r)}`,
        `${fmtDateTime(r.observed_at)}${r.observed_until ? ` – ${fmtTime(r.observed_until)}` : ""}${duration(r.observed_at, r.observed_until) ? ` (${duration(r.observed_at, r.observed_until)})` : ""}`,
        wz ? WATCH_ZONE_LABEL[wz] : bz ? BASE_ZONE_LABEL[bz] : null,
        r.category ? categoryLabel(r.category) : null,
      ]
        .filter(Boolean)
        .join("\n");
      if (r.venue_name || r.cell_size_m === 0) {
        f.push({ type: "Feature", geometry: { type: "Point", coordinates: [r.public_lng, r.public_lat] }, properties: { color, size: on ? 10 : 8, label } });
      } else {
        f.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [gridCellRing({ lat: r.public_lat, lng: r.public_lng }, r.cell_size_m)] },
          properties: { color, opacity: on ? 0.45 : 0.16, dashed: !on, label },
        });
      }
    });
    return f;
  }, [route, visits, selected, stopZones, watchZones, homeArea]);

  const days = useMemo(() => {
    const m = new Map<string, { visits: PublicHistoryRecord[]; samples: number }>();
    for (const r of records) {
      const k = londonDayKey(r.observed_at);
      const d = m.get(k) ?? { visits: [], samples: 0 };
      if (r.kind === "visit") d.visits.push(r);
      else d.samples++;
      m.set(k, d);
    }
    // Latest day first, and within a day the latest stop first.
    for (const d of m.values()) d.visits.sort((a, b) => b.observed_at.localeCompare(a.observed_at));
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [records]);
  const numberOf = useMemo(() => new Map(visits.map((v, i) => [v.id, i + 1])), [visits]);

  const legendZones: Zone[] = watched ? (["purple", "red", "amber", "yellow", "green"] as Zone[]).filter((z) => usedZones.has(z) || z === "green" || z === "yellow") : ["green", "yellow", "red"];
  const legendText = (z: Zone) =>
    watched
      ? z === "purple" || z === "amber"
        ? WATCH_ZONE_LABEL[z]
        : z === "red"
          ? "In one of your Want areas, or one of my noted areas"
          : BASE_ZONE_LABEL[z as BaseZone]
      : BASE_ZONE_LABEL[z as BaseZone];

  return (
    <div className="flex flex-wrap gap-6">
      <div className="min-w-0 grow-[7] basis-[520px]">
        <div className="lg:sticky lg:top-24">
          <MapFrame
            legend={
              <>
                {legendZones.map((z) => (
                  <LegendItem key={z} swatch={<span className="inline-block h-[3px] w-6 rounded" style={{ background: ZONE_COLOR[z] }} />}>
                    {legendText(z)}
                  </LegendItem>
                ))}
                {!exact && <LegendItem swatch={<span className="inline-block h-3.5 w-3.5 border-2 border-dashed" style={{ borderColor: NEUTRAL }} />}>Stay (approximate area)</LegendItem>}
                <LegendItem swatch={<span className="inline-block h-3.5 w-3.5" style={{ background: SELECTED }} />}>Selected</LegendItem>
              </>
            }
          >
            <LazyMap features={features} className="h-[300px] w-full sm:h-[460px] lg:h-[620px]" ariaLabel="Map of published movement: routes and stays" />
          </MapFrame>
        </div>
      </div>

      <div className="min-w-0 grow-[5] basis-[380px] space-y-6" aria-label="Chronological timeline">
        {!records.length && (
          <EmptyState icon="history" title="No published records for these dates.">
            Usually this means I stayed near home, which is never shown. Try a different date range.
          </EmptyState>
        )}
        {days.map(([day, d]) => (
          <section key={day}>
            <div className="sticky top-16 z-10 -mx-1 flex items-baseline justify-between bg-background px-1 py-2 lg:top-[72px]">
              <h2 className="text-lg font-bold">{fmtDate(`${day}T12:00:00Z`, { dateStyle: "full" })}</h2>
              <span className="text-xs text-muted">
                {d.visits.length} stay{d.visits.length === 1 ? "" : "s"}
                {d.samples ? ` · route recorded` : ""}
              </span>
            </div>
            {d.visits.length ? (
              <ol className="space-y-3">
                {d.visits.map((r) => {
                  const on = r.id === selected;
                  // One colour per card: the watcher's own, or else everyone's.
                  const c = cardColour(stopZones[r.id] ?? null, watchZones?.[r.id] ?? null);
                  const card = (
                    <button
                      type="button"
                      onClick={() => setSelected(on ? null : r.id)}
                      aria-pressed={on}
                      className={cn("block w-full overflow-hidden rounded-xl border-2 text-left text-sm transition", on && "ring-2 ring-ink ring-offset-2")}
                      style={{ borderColor: c.color, background: c.key ? `color-mix(in srgb, ${c.color} 9%, #fff)` : "#fff" }}
                    >
                      <span className="flex items-center gap-2 px-3 py-2 font-semibold" style={{ background: c.key ? c.color : "#E6EEF7", color: onZone(c.key) }}>
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/90 text-xs font-bold text-ink tabular-nums">
                          {numberOf.get(r.id)}
                        </span>
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{stayName(r)}</span>
                        {c.label && <span className="hidden text-xs font-semibold sm:inline">{c.label}</span>}
                      </span>
                      <span className="block px-3 py-2 text-ink/80 tabular-nums">
                        {fmtTime(r.observed_at)}
                        {r.observed_until ? `–${fmtTime(r.observed_until)}` : ""}
                        {duration(r.observed_at, r.observed_until) ? ` · ${duration(r.observed_at, r.observed_until)}` : ""}
                        {r.category ? ` · ${categoryLabel(r.category)}` : ""}
                        {c.label && <span className="block text-xs sm:hidden">{c.label}</span>}
                      </span>
                    </button>
                  );
                  return <li key={r.id}>{card}</li>;
                })}
              </ol>
            ) : (
              <p className="rounded-xl border border-dashed border-[#93A4B5] bg-[#F7FAFD] p-3 text-sm text-muted">
                No stops recorded this day. See the route on the map.
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
