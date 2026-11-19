"use client";

import { useEffect, useState } from "react";
import type { PublicHistoryRecord } from "@/lib/public-data";
import { fmtDateTime, fmtTime, londonDayKey } from "@/lib/format";
import { StayPlace } from "@/components/stay-place";

interface Visit {
  id: string;
  from: string;
  until: string | null;
}

/** Under a selected stay: where it was, and every published visit to the same place. */
export function PlaceVisits({ record }: { record: PublicHistoryRecord }) {
  const [data, setData] = useState<{ count: number; visits: Visit[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ lat: String(record.public_lat), lng: String(record.public_lng), cell: String(record.cell_size_m) });
    if (record.venue_name) q.set("name", record.venue_name);
    fetch(`/api/public/visits?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [record]);

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-hairline bg-white p-3 text-sm">
      <StayPlace lat={record.public_lat} lng={record.public_lng} cellSizeM={record.cell_size_m} label={record.venue_name ?? record.area_label} />
      {failed && <p className="text-muted">Earlier visits couldn&apos;t be loaded.</p>}
      {!data && !failed && <p className="text-muted">Loading visits to this place…</p>}
      {data && (
        <>
          <p className="font-semibold">
            Visits to this place: {data.count}
            {data.count > data.visits.length ? ` (latest ${data.visits.length} shown)` : ""}
          </p>
          <ol className="max-h-60 space-y-0.5 overflow-y-auto tabular-nums">
            {data.visits.map((v) => (
              <li key={v.id} className={v.id === record.id ? "font-semibold" : "text-ink/80"}>
                {fmtDateTime(v.from)}
                {v.until ? ` – ${londonDayKey(v.until) === londonDayKey(v.from) ? fmtTime(v.until) : fmtDateTime(v.until)}` : ""}
                {v.id === record.id ? " (this one)" : ""}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
