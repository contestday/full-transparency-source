"use client";

import type { MapFeature } from "@/components/map-lazy";
import { Badge } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { circleRing } from "@/lib/geo";
import type { AreaGeometry } from "@/lib/geofence/area-geometry";
import { describeRecurrence, EVENT_COLOR, EVENT_LEVEL_META, homeAssurance, PHASE_LABEL, type EventLevel, type EventPhase, type Recurrence } from "@/lib/events/rules";
import { fmtDate } from "@/lib/format";

export interface EventPlaceView {
  name: string;
  kind: "venue" | "place";
  center_lat: number;
  center_lng: number;
  radius_m: number | null;
  geojson: AreaGeometry;
}

export interface EventView {
  reference: string;
  title: string;
  details: string | null;
  level: EventLevel;
  starts_at: string;
  ends_at: string;
  status: "active" | "cancelled";
  includes_home: boolean;
  /** One of my own bans (public). */
  is_owner?: boolean;
  recurrence?: Recurrence | null;
  phase: EventPhase;
  places: EventPlaceView[];
}

/** Black areas on a map (strong while the event is on, faint otherwise). */
export function eventFeatures(events: EventView[]): MapFeature[] {
  return events
    .filter((e) => e.phase !== "cancelled")
    .flatMap((e) =>
      e.places.map((p) => ({
        type: "Feature" as const,
        geometry: p.geojson,
        properties: {
          color: EVENT_COLOR,
          opacity: e.phase === "on" ? 0.35 : 0.12,
          dashed: e.phase !== "on",
          label: `Event (${EVENT_LEVEL_META[e.level].label}) · ${e.title}\n${p.name} · ${PHASE_LABEL[e.phase]}`,
        },
      })),
    );
}

/** A circle for a venue as it's being added (before saving). */
export function venueGeometry(center: { lat: number; lng: number }, radiusM: number): AreaGeometry {
  return { type: "Polygon", coordinates: [circleRing(center, radiusM, 64)] };
}

const fmtRadius = (m: number) => (m >= 1609 ? `${(m / 1609.344).toFixed(m % 1609 < 50 ? 0 : 1)} mile${m >= 1700 ? "s" : ""}` : `${Math.round(m)} m`);

export function EventLevelBadge({ level }: { level: EventLevel }) {
  return <Badge tone="black">{EVENT_LEVEL_META[level].label}</Badge>;
}

export function EventCardBody({ e, ownerFirst, children }: { e: EventView; ownerFirst: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: EVENT_COLOR }} aria-hidden="true" />
        <span className="text-base font-semibold">{e.title}</span>
        {e.is_owner ? <Badge tone="red">Banned</Badge> : <EventLevelBadge level={e.level} />}
        <Badge tone={e.phase === "on" ? "black" : "neutral"}>{e.recurrence && e.phase === "upcoming" ? "Repeats" : PHASE_LABEL[e.phase]}</Badge>
        <span className="ml-auto font-mono text-xs text-muted">{e.reference}</span>
      </div>
      {e.recurrence ? (
        <p className="tabular-nums">
          <strong>{describeRecurrence(e.recurrence, { end: true })}</strong> (UK time). Starts {fmtDate(e.starts_at)}.
        </p>
      ) : (
        <p className="tabular-nums">
          {fmtDateTime(e.starts_at)} to {fmtDateTime(e.ends_at)}
        </p>
      )}
      <ul className="list-disc pl-5">
        {e.places.map((p, i) => (
          <li key={i}>
            {p.name}
            {p.kind === "venue" && p.radius_m ? <span className="text-muted"> · within {fmtRadius(p.radius_m)}</span> : null}
          </li>
        ))}
      </ul>
      {e.details && <p className="whitespace-pre-line">{e.details}</p>}
      {e.includes_home && (
        <p className="rounded-lg border border-border bg-slate-50 p-2 text-sm">
          <strong>Includes home.</strong> {homeAssurance(ownerFirst)}
        </p>
      )}
      {children}
    </div>
  );
}
