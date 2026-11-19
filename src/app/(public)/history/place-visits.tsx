"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicHistoryRecord } from "@/lib/public-data";
import { fmtDateTime, fmtTime, londonDayKey } from "@/lib/format";
import { quickRanges } from "@/lib/history-range";
import { durationText } from "@/lib/area-visits";
import { gridCellRing } from "@/lib/geo";
import { useNow } from "@/lib/use-now";
import { Overlay } from "@/components/overlay";
import { Button } from "@/components/ui";
import { StayPlace } from "@/components/stay-place";
import { LazyMap, type MapFeature } from "@/components/map-lazy";

interface Visit {
  id: string;
  from: string;
  until: string | null;
}

const when = (v: Visit) =>
  `${fmtDateTime(v.from)}${v.until ? ` – ${londonDayKey(v.until) === londonDayKey(v.from) ? fmtTime(v.until) : fmtDateTime(v.until)}` : ""}`;

/** Every published visit to the same place as a stay, for a chosen period (same overlay as "Times in this area"). */
export function PlaceTimes({ record, name, onClose }: { record: PublicHistoryRecord; name: string; onClose: () => void }) {
  const now = useNow();
  const today = now ? londonDayKey(new Date(now).toISOString()) : null;
  const [rangeKey, setRangeKey] = useState("week");
  const [all, setAll] = useState<Visit[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ lat: String(record.public_lat), lng: String(record.public_lng), cell: String(record.cell_size_m) });
    if (record.venue_name) q.set("name", record.venue_name);
    fetch(`/api/public/visits?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { visits: Visit[] }) => live && setAll(d.visits))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [record]);

  const visits = useMemo(() => {
    const range = today ? quickRanges(today).find((r) => r.key === rangeKey) : null;
    return all && range ? all.filter((v) => londonDayKey(v.from) >= range.from && londonDayKey(v.from) <= range.to) : [];
  }, [all, today, rangeKey]);
  const total = visits.reduce((ms, v) => ms + (v.until ? Date.parse(v.until) - Date.parse(v.from) : 0), 0);

  const features = useMemo<MapFeature[]>(() => {
    const c = { lat: record.public_lat, lng: record.public_lng };
    return record.cell_size_m
      ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [gridCellRing(c, record.cell_size_m)] }, properties: { color: "#1d4ed8", opacity: 0.25, dashed: true, label: name } }]
      : [{ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { color: "#1d4ed8", size: 9, label: name } }];
  }, [record, name]);

  return (
    <Overlay title={`Times at “${name}”`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Which period">
          {(today ? quickRanges(today) : []).map((r) => (
            <Button key={r.key} type="button" size="sm" variant={rangeKey === r.key ? "primary" : "secondary"} aria-pressed={rangeKey === r.key} onClick={() => setRangeKey(r.key)}>
              {r.label}
            </Button>
          ))}
        </div>
        <LazyMap features={features} className="h-[220px] w-full sm:h-[260px]" ariaLabel={`Map of ${name}`} />
        <StayPlace lat={record.public_lat} lng={record.public_lng} cellSizeM={record.cell_size_m} label={record.venue_name ?? record.area_label} />
        {failed && <p className="text-sm text-muted">The visits couldn&apos;t be loaded.</p>}
        {!all && !failed && <p className="text-sm text-muted">Loading…</p>}
        {all && (
          <>
            <p className="text-sm">
              <strong>{visits.length}</strong> {visits.length === 1 ? "visit" : "visits"}
              {total > 0 ? `, ${durationText(new Date(0).toISOString(), new Date(total).toISOString(), 0)} in all` : ""}.
            </p>
            {visits.length > 0 && (
              <ol className="divide-y divide-hairline rounded-xl border border-hairline text-sm">
                {visits.map((v) => (
                  <li key={v.id} className={`flex flex-wrap justify-between gap-x-4 px-3 py-2 tabular-nums ${v.id === record.id ? "font-semibold" : ""}`}>
                    <span>
                      {when(v)}
                      {v.id === record.id ? " · this one" : ""}
                    </span>
                    <span className="text-muted">{v.until ? durationText(v.from, v.until, now) : ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </Overlay>
  );
}
