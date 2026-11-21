"use client";

import { useMemo, useState } from "react";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { restrictionFeatures, useRestrictions } from "@/components/restrictions";
import { EmptyState, Icon, LegendItem, MapFrame, STATUS_TONE, StatChip } from "@/components/design";
import { cn } from "@/components/ui";
import { cardColour } from "@/components/zone-card";
import { gridCellRing } from "@/lib/geo";
import { categoryLabel } from "@/lib/plans";
import { BASE_ZONE_LABEL, WATCH_ZONE_LABEL, ZONE_COLOR, type BaseZone, type WatchZone, type Zone } from "@/lib/geofence/tiers";
import { fmtDate, fmtDateTime, fmtTime, londonDayKey } from "@/lib/format";
import type { PublicHistoryRecord } from "@/lib/public-data";
import { homeAreaFeatures, type HomeAreaShape } from "@/lib/home-area";
import { useNow } from "@/lib/use-now";
import { PlaceTimes } from "./place-visits";
import type { AreaGeometry } from "@/lib/geofence/area-geometry";

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

/** Minutes since London midnight. */
const londonMinutes = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return Number(p.find((x) => x.type === "hour")?.value ?? 0) * 60 + Number(p.find((x) => x.type === "minute")?.value ?? 0);
};

/** Status key for a card colour (for tints): base zones and the watcher's own. */
const toneOf = (key: string | null) => (key === "green" || key === "yellow" || key === "red" || key === "amber" || key === "purple" ? key : "unknown");

/** Ribbon colours besides the stays: travelling, and time with nothing published (usually at home). */
const TRAVEL = "#9FB4C9";
const HOME_TIME = "#A8E0C9";
const TRACK_GAP_MIN = 20;

/**
 * A day as a 24-hour bar: each stay in its colour, travelling (route samples)
 * in grey-blue, and the rest in light green: nothing is published inside my
 * home area, so unpublished time is usually time at home. Later today stays blank.
 */
function DayRibbon({ stays, tracks, colourOf, nowMin }: { stays: PublicHistoryRecord[]; tracks: PublicHistoryRecord[]; colourOf: (r: PublicHistoryRecord) => string; nowMin: number }) {
  const dayEnd = nowMin; // 1440 for past days
  const segs: { start: number; end: number; color: string; name: string }[] = [];
  // Travelling: between route samples that are close together.
  const t = [...tracks].map((r) => londonMinutes(r.observed_at)).sort((x, y) => x - y);
  for (let i = 0; i < t.length; i++) {
    const end = i + 1 < t.length && t[i + 1] - t[i] <= TRACK_GAP_MIN ? t[i + 1] : t[i] + 5;
    segs.push({ start: t[i], end: Math.min(end, dayEnd), color: TRAVEL, name: "Travelling" });
  }
  for (const r of [...stays].sort((x, y) => x.observed_at.localeCompare(y.observed_at))) {
    const start = londonMinutes(r.observed_at);
    const endRaw = r.observed_until ? londonMinutes(r.observed_until) : start + 10;
    const end = r.observed_until && londonDayKey(r.observed_until) !== londonDayKey(r.observed_at) ? dayEnd : Math.max(endRaw, start + 4);
    segs.push({ start, end: Math.min(end, dayEnd), color: colourOf(r), name: stayName(r) });
  }
  const label = `${segs.filter((x) => x.name !== "Travelling").length ? `Stays this day: ${segs.filter((x) => x.name !== "Travelling").map((x) => `${x.name} ${String(Math.floor(x.start / 60)).padStart(2, "0")}:${String(x.start % 60).padStart(2, "0")}`).join(", ")}. ` : ""}The rest of the day: travelling, or nothing published (usually at home).`;
  return (
    <div className="mb-3">
      <div className="relative h-2.5 overflow-hidden rounded-full bg-grey-bg" role="img" aria-label={label}>
        {/* Up to now, unpublished time is shown as (probably) home. */}
        <span className="absolute inset-y-0 left-0" style={{ width: `${(dayEnd / 1440) * 100}%`, background: HOME_TIME }} />
        {segs.map((x, i) => (
          <span key={i} className="absolute inset-y-0" style={{ left: `${(x.start / 1440) * 100}%`, width: `${(Math.max(0, x.end - x.start) / 1440) * 100}%`, background: x.color }} />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] text-muted tabular-nums" aria-hidden="true">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}

/** The key for the day ribbons. */
function RibbonKey() {
  const item = (color: string, text: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-4 rounded-full" style={{ background: color }} aria-hidden="true" />
      {text}
    </span>
  );
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {item("#007B60", "Stay (in its colour)")}
      {item(TRAVEL, "Travelling")}
      {item(HOME_TIME, "Home area: never published")}
    </p>
  );
}
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
  searchArea = null,
}: {
  /** Public history place search: the searched place, outlined. */
  searchArea?: AreaGeometry | null;
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

  const restrictions = useRestrictions();
  const features = useMemo<MapFeature[]>(() => {
    const f: MapFeature[] = [...restrictionFeatures(restrictions), ...homeAreaFeatures(homeArea)];
    if (searchArea) f.push({ type: "Feature", geometry: searchArea, properties: { color: "#142B49", opacity: 0.04, dashed: true, label: "The place searched" } });
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
      if (!(r.venue_name || r.cell_size_m === 0)) {
        f.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [gridCellRing({ lat: r.public_lat, lng: r.public_lng }, r.cell_size_m)] },
          properties: { color, opacity: on ? 0.3 : 0.1, dashed: true, label },
        });
      }
      // A numbered pin, matching the numbered card in the timeline.
      f.push({ type: "Feature", geometry: { type: "Point", coordinates: [r.public_lng, r.public_lat] }, properties: { color, size: on ? 14 : 11, num: i + 1, label } });
    });
    return f;
  }, [route, visits, selected, stopZones, watchZones, homeArea, searchArea, restrictions]);

  // A place search: zoom to the place.
  const searchFocus = useMemo(() => (searchArea ? { key: 1, features: [{ type: "Feature", geometry: searchArea, properties: {} } as MapFeature] } : null), [searchArea]);

  const [timesFor, setTimesFor] = useState<PublicHistoryRecord | null>(null);
  // "Show on map": zoom to one stay.
  const [pinFocus, setPinFocus] = useState<{ key: number; features: MapFeature[] } | null>(null);
  const showOnMap = (r: PublicHistoryRecord) =>
    setPinFocus((p) => ({ key: (p?.key ?? 0) + 1, features: [{ type: "Feature", geometry: { type: "Point", coordinates: [r.public_lng, r.public_lat] }, properties: {} }] }));

  // The period in numbers: stays, places, and how much stay time was within the okay zone.
  const stats = useMemo(() => {
    const places = new Set(visits.map((v) => stayName(v).toLowerCase())).size;
    let total = 0;
    let okay = 0;
    for (const v of visits) {
      if (!v.observed_until) continue;
      const ms = Date.parse(v.observed_until) - Date.parse(v.observed_at);
      if (!(ms > 0)) continue;
      total += ms;
      if (stopZones[v.id] === "green") okay += ms;
    }
    return { stays: visits.length, places, okayPct: total > 0 ? Math.round((okay / total) * 100) : null };
  }, [visits, stopZones]);
  const now = useNow();
  const todayKey = now ? londonDayKey(new Date(now).toISOString()) : "";
  const nowMin = now ? londonMinutes(new Date(now).toISOString()) : 1440;
  const colourOf = (r: PublicHistoryRecord) => cardColour(stopZones[r.id] ?? null, watchZones?.[r.id] ?? null).color;

  const days = useMemo(() => {
    const m = new Map<string, { visits: PublicHistoryRecord[]; samples: number; tracks: PublicHistoryRecord[] }>();
    for (const r of records) {
      const k = londonDayKey(r.observed_at);
      const d = m.get(k) ?? { visits: [], samples: 0, tracks: [] };
      if (r.kind === "visit") d.visits.push(r);
      else {
        d.samples++;
        d.tracks.push(r);
      }
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
            <LazyMap
              features={features}
              fit={searchArea ? false : true}
              focus={pinFocus ?? searchFocus}
              className="h-[300px] w-full sm:h-[460px] lg:h-[620px]" ariaLabel="Map of published movement: routes and stays" />
          </MapFrame>
        </div>
      </div>

      {timesFor && <PlaceTimes record={timesFor} name={stayName(timesFor)} onClose={() => setTimesFor(null)} />}
      <div className="min-w-0 grow-[5] basis-[380px] space-y-6" aria-label="Chronological timeline">
        {records.length > 0 && (
          <div className="ft-scroll-x -mx-1 flex gap-2 px-1">
            <StatChip value={String(stats.stays)} label={stats.stays === 1 ? "stay" : "stays"} />
            <StatChip value={String(stats.places)} label={stats.places === 1 ? "place" : "places"} />
            {stats.okayPct != null && <StatChip tone="green" dot value={`${stats.okayPct}%`} label="of stay time in okay zone" />}
          </div>
        )}
        {records.length > 0 && <RibbonKey />}
        {!records.length && (
          <EmptyState icon="history" title="No published records for these dates.">
            Usually this means I stayed near home, which is never shown. Try a different date range.
          </EmptyState>
        )}
        {days.map(([day, d]) => (
          <section key={day}>
            <div className="-mx-1 flex items-baseline justify-between px-1 pb-1 pt-2">
              <h2 className="text-lg font-bold">{fmtDate(`${day}T12:00:00Z`, { dateStyle: "full" })}</h2>
              <span className="text-xs text-muted">
                {d.visits.length} stay{d.visits.length === 1 ? "" : "s"}
                {d.samples ? ` · route recorded` : ""}
              </span>
            </div>
            <DayRibbon stays={d.visits} tracks={d.tracks} colourOf={colourOf} nowMin={day === todayKey ? nowMin : 1440} />
            {d.visits.length ? (
              <ol className="space-y-2.5">
                {d.visits.map((r) => {
                  const on = r.id === selected;
                  // One colour per card: the watcher's own, or else everyone's.
                  const c = cardColour(stopZones[r.id] ?? null, watchZones?.[r.id] ?? null);
                  const tone = STATUS_TONE[toneOf(c.key)];
                  return (
                    <li key={r.id} className={cn("rounded-2xl border bg-white transition", on ? "border-2 border-ink shadow-[0_8px_24px_rgb(20_43_73/10%)]" : "border-hairline")}>
                      <button type="button" onClick={() => setSelected(on ? null : r.id)} aria-pressed={on} className="flex w-full items-center gap-3 p-3 text-left">
                        <span
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-white text-[13px] font-bold text-white tabular-nums shadow-[0_0_0_1px_#C5D6E5]"
                          style={{ background: c.key ? c.color : NEUTRAL }}
                        >
                          {numberOf.get(r.id)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-bold [overflow-wrap:anywhere]">{stayName(r)}</span>
                          <span className="block text-[13px] text-muted tabular-nums">
                            {fmtTime(r.observed_at)}
                            {r.observed_until ? ` – ${fmtTime(r.observed_until)}` : ""}
                            {duration(r.observed_at, r.observed_until) ? ` · ${duration(r.observed_at, r.observed_until)}` : ""}
                            {r.category ? ` · ${categoryLabel(r.category)}` : ""}
                          </span>
                        </span>
                        {c.label && (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: tone.bg, color: tone.ink }}>
                            <span className="h-2 w-2 rounded-full" style={{ background: c.color }} aria-hidden="true" />
                            <span className="max-w-[9rem] truncate">{c.label}</span>
                          </span>
                        )}
                      </button>
                      {on && (
                        <div className="flex gap-2 px-3 pb-3">
                          <button
                            type="button"
                            onClick={() => setTimesFor(r)}
                            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-white hover:bg-accent-hover"
                          >
                            <Icon name="clock" className="h-5 w-5" /> All times here
                          </button>
                          <button
                            type="button"
                            aria-label="Show on map"
                            onClick={() => showOnMap(r)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-hairline bg-white"
                          >
                            <Icon name="map" />
                          </button>
                        </div>
                      )}
                    </li>
                  );
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
