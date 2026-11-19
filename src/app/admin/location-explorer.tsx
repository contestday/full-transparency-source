"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { Badge, Button, Card, Input, Notice, Select } from "@/components/ui";
import { api } from "@/lib/client-api";
import { circleRing } from "@/lib/geo";
import { fmtDateTime, fmtTime, relativeAge } from "@/lib/format";
import { categoryLabel } from "@/lib/plans";
import { LIVE_STATUS_META, type LiveStatus } from "@/lib/live-status";
import type { MapFence } from "./map-context";
import { signedDistanceM, type AreaGeometry } from "@/lib/geofence/area-geometry";
import { formatDistance } from "@/components/address-search";

interface Obs {
  id: string;
  source: string;
  observed_at: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  import_batch_id: string | null;
}
interface Visit {
  id: string;
  started_at: string;
  ended_at: string;
  lat: number;
  lng: number;
  radius_m: number | null;
  category: string | null;
  confidence: number;
  planned_activity_id: string | null;
}
type Fence = MapFence;

/** How each kind of area is drawn on the private maps. */
const GROUPS: Record<MapFence["group"], { label: string; color: string }> = {
  mine: { label: "My noted areas", color: "#142B49" },
  wish: { label: "Wish (amber)", color: "#F08C00" },
  want: { label: "Want (red)", color: "#C62828" },
  location: { label: "Sample Location (purple)", color: "#7E22CE" },
};
const NEAR_M = 1500;
interface PlanPoint {
  id: string;
  title: string;
  starts_at: string;
  lat: number;
  lng: number;
}

const SOURCE_COLOURS: Record<string, string> = {
  followmee: "#1d4ed8",
  google_timeline: "#7c3aed",
  ingest_api: "#0f766e",
  manual: "#64748b",
};

function isStale(observedAt: string | null, staleMinutes: number) {
  return !observedAt || Date.now() - Date.parse(observedAt) > staleMinutes * 60_000;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function LocationExplorer({
  mode,
  geofences = [],
  plans = [],
  staleMinutes,
  batches = [],
  liveStatus = "unknown",
}: {
  liveStatus?: LiveStatus;
  mode: "live" | "history";
  geofences?: Fence[];
  plans?: PlanPoint[];
  staleMinutes: number;
  batches?: { id: string; source: string; file_name: string | null; created_at: string }[];
}) {
  const [from, setFrom] = useState(() => localInput(new Date(Date.now() - (mode === "live" ? 12 : 72) * 3600_000)));
  const [to, setTo] = useState(() => localInput(new Date()));
  const [source, setSource] = useState("");
  const [batch, setBatch] = useState("");
  const [category, setCategory] = useState("");
  const [data, setData] = useState<{ observations: Obs[]; visits: Visit[]; latest: Obs | null; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [layers, setLayers] = useState({ route: true, points: mode === "history", visits: true, plans: true });
  const [groups, setGroups] = useState<Record<MapFence["group"], boolean>>({ mine: true, wish: true, want: true, location: true });

  const query = useMemo(() => {
    const p = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    if (source) p.set("source", source);
    if (batch) p.set("batch_id", batch);
    if (category) p.set("category", category);
    return p;
  }, [from, to, source, batch, category]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api(`/api/admin/locations?${query.toString()}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    // Initial load only; subsequent loads are explicit (or via the live timer).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "live") return;
    const t = setInterval(() => {
      setTo(localInput(new Date()));
      void load();
    }, 60_000);
    return () => clearInterval(t);
  }, [mode, load]);

  const features = useMemo<MapFeature[]>(() => {
    const f: MapFeature[] = [];
    for (const g of geofences) {
      if (!groups[g.group]) continue;
      f.push({
        type: "Feature",
        geometry: g.geojson,
        properties: {
          color: GROUPS[g.group].color,
          // "Rather I didn't leave" Wish areas: outline only (the amber part is outside them).
          dashed: g.outside,
          opacity: g.outside ? 0 : 0.14,
          label: `${GROUPS[g.group].label}${g.sample ? " · sample" : ""}${g.outside ? " · rather I didn't leave" : ""}\n${g.reference}${g.name ? `\n${g.name.slice(0, 120)}` : ""}`,
        },
      });
    }
    if (layers.plans) {
      for (const p of plans) {
        f.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { color: "#16a34a", size: 5, label: `Plan: ${p.title}\n${fmtDateTime(p.starts_at)}` } });
      }
    }
    const obs = data?.observations ?? [];
    if (layers.route && obs.length > 1) {
      f.push({ type: "Feature", geometry: { type: "LineString", coordinates: obs.map((o) => [o.lng, o.lat]) }, properties: { color: "#1d4ed8" } });
    }
    if (layers.points) {
      for (const o of obs) {
        f.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [o.lng, o.lat] },
          properties: { color: SOURCE_COLOURS[o.source] ?? "#334155", size: 3, label: `${fmtDateTime(o.observed_at)}\n${o.source}${o.accuracy_m != null ? ` ±${Math.round(o.accuracy_m)} m` : ""}` },
        });
      }
    }
    if (layers.visits) {
      for (const v of data?.visits ?? []) {
        f.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [v.lng, v.lat] },
          properties: {
            color: "#9333ea",
            size: 7,
            label: `Recorded visit\n${fmtDateTime(v.started_at)}–${fmtTime(v.ended_at)}\n${categoryLabel(v.category)} · confidence ${Math.round(v.confidence * 100)}%${v.planned_activity_id ? "\nMatches a plan" : ""}`,
          },
        });
      }
    }
    const latest = data?.latest;
    if (latest) {
      if (latest.accuracy_m) {
        f.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [circleRing(latest, latest.accuracy_m, 48)] }, properties: { color: "#0ea5e9", opacity: 0.15 } });
      }
      f.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [latest.lng, latest.lat] },
        properties: { color: LIVE_STATUS_META[liveStatus].color, size: 10, label: `${LIVE_STATUS_META[liveStatus].label}
Latest: ${fmtDateTime(latest.observed_at)}\n${latest.source}${latest.accuracy_m != null ? ` ±${Math.round(latest.accuracy_m)} m` : ""}` },
      });
    }
    return f;
  }, [data, geofences, plans, layers, groups, liveStatus]);

  const latest = data?.latest ?? null;
  const stale = isStale(latest?.observed_at ?? null, staleMinutes);

  // Which areas the latest fix is in, and which are close (positive = inside).
  const proximity = useMemo(() => {
    if (!latest) return { inside: [] as { g: Fence; d: number }[], near: [] as { g: Fence; d: number }[] };
    const rows = geofences.map((g) => {
      const d = signedDistanceM({ lat: latest.lat, lng: latest.lng }, g.geojson as AreaGeometry);
      return { g, d: g.outside ? -d : d };
    });
    return {
      inside: rows.filter((r) => r.d >= 0).sort((a, b) => order(a.g) - order(b.g)),
      near: rows.filter((r) => r.d < 0 && -r.d <= NEAR_M).sort((a, b) => b.d - a.d),
    };
  }, [latest, geofences]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: LIVE_STATUS_META[liveStatus].color }} aria-hidden="true" />
          {LIVE_STATUS_META[liveStatus].label} ·
        </span>
        <span className="font-medium">Latest position:</span>
        {latest ? (
          <>
            <span>
              {fmtDateTime(latest.observed_at)} ({relativeAge(latest.observed_at)})
            </span>
            {stale ? <Badge tone="red">Stale</Badge> : <Badge tone="green">Current</Badge>}
            {latest.accuracy_m != null && <Badge>±{Math.round(latest.accuracy_m)} m</Badge>}
            <Badge tone={latest.source === "google_timeline" ? "purple" : "blue"}>{latest.source === "google_timeline" ? "Imported" : latest.source}</Badge>
          </>
        ) : (
          <Badge tone="red">No data</Badge>
        )}
      </div>

      <Card className="space-y-2 p-3 text-sm">
        <p className="font-semibold">Where I am (latest fix)</p>
        {!latest ? (
          <p className="text-muted">No position yet.</p>
        ) : (
          <>
            <p>
              <span className="font-medium">In:</span>{" "}
              {proximity.inside.length ? (
                proximity.inside.map(({ g }) => <AreaChip key={g.id} g={g} />)
              ) : (
                <span className="text-muted">none of the areas</span>
              )}
            </p>
            <p>
              <span className="font-medium">Within {formatDistance(NEAR_M)}:</span>{" "}
              {proximity.near.length ? (
                proximity.near.map(({ g, d }) => <AreaChip key={g.id} g={g} extra={`${formatDistance(-d)} away`} />)
              ) : (
                <span className="text-muted">nothing close</span>
              )}
            </p>
          </>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline pt-2" role="group" aria-label="Areas shown on the map">
          {(Object.keys(GROUPS) as MapFence["group"][]).map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={groups[k]} onChange={(e) => setGroups((g) => ({ ...g, [k]: e.target.checked }))} />
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: GROUPS[k].color }} aria-hidden="true" />
              {GROUPS[k].label} ({geofences.filter((g) => g.group === k).length})
            </label>
          ))}
        </div>
      </Card>

      <Card className="flex flex-wrap items-end gap-3 p-3">
        <label className="text-sm">
          <span className="block font-medium">From</span>
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
        </label>
        <label className="text-sm">
          <span className="block font-medium">To</span>
          <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Source</span>
          <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-auto">
            <option value="">All</option>
            <option value="followmee">FollowMee</option>
            <option value="google_timeline">Google Timeline</option>
            <option value="ingest_api">Ingest API</option>
          </Select>
        </label>
        {mode === "history" && (
          <>
            <label className="text-sm">
              <span className="block font-medium">Import batch</span>
              <Select value={batch} onChange={(e) => setBatch(e.target.value)} className="w-auto max-w-56">
                <option value="">Any</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.file_name ?? b.source} · {fmtDateTime(b.created_at)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm">
              <span className="block font-medium">Visit category</span>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. pub" className="w-32" />
            </label>
          </>
        )}
        <Button onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Apply"}
        </Button>
        {mode === "history" && (
          <div className="flex gap-2 text-sm">
            <a className="text-accent underline" href={`/api/admin/locations?${query.toString()}&format=csv&limit=20000`}>
              Export CSV
            </a>
            <a className="text-accent underline" href={`/api/admin/locations?${query.toString()}&format=geojson&limit=20000`}>
              Export GeoJSON
            </a>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap gap-3 text-sm" role="group" aria-label="Layers">
        {(Object.keys(layers) as (keyof typeof layers)[]).map((k) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))} />
            {{ route: "Route", points: "Points", visits: "Visits", fences: "Geofences", plans: "Plans" }[k]}
          </label>
        ))}
      </div>

      {error && <Notice tone="red">{error}</Notice>}
      {data?.truncated && <Notice tone="amber">Showing the first {data.observations.length} observations. Narrow the range to see all.</Notice>}

      <div className={mode === "history" ? "grid gap-4 lg:grid-cols-[1fr_340px]" : ""}>
        <LazyMap features={features} className="h-[65vh] min-h-80 w-full" ariaLabel="Private location map" />
        {mode === "history" && (
          <div className="max-h-[65vh] space-y-1 overflow-y-auto text-sm" aria-label="Movement timeline">
            <p className="font-semibold">
              {data?.observations.length ?? 0} observations · {data?.visits.length ?? 0} visits
            </p>
            {(data?.visits ?? []).map((v) => (
              <div key={v.id} className="rounded border border-purple-200 bg-purple-50 p-2">
                <p className="font-medium">
                  Visit {fmtDateTime(v.started_at)}–{fmtTime(v.ended_at)}
                </p>
                <p className="text-xs text-muted">
                  {categoryLabel(v.category)} · ±{v.radius_m ?? "?"} m · {Math.round(v.confidence * 100)}% confidence
                  {v.planned_activity_id ? " · matches plan" : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        Blue line = route; large dot = latest position (coloured by status) with its accuracy circle; purple dots = recorded visits; green = plans.
        Areas: navy = mine, amber = Wish, red = Want, purple = the public sample&apos;s Locations (real watchers&apos; Locations stay private).
      </p>
    </div>
  );
}

const ORDER: Record<MapFence["group"], number> = { location: 0, want: 1, wish: 2, mine: 3 };
const order = (g: MapFence) => ORDER[g.group];

function AreaChip({ g, extra }: { g: MapFence; extra?: string }) {
  return (
    <span className="mr-1.5 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: GROUPS[g.group].color }} aria-hidden="true" />
      {g.name || g.reference}
      {g.sample ? " (sample)" : ""}
      {extra ? ` · ${extra}` : ""}
    </span>
  );
}
