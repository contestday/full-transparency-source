"use client";

import { useMemo, useState } from "react";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { AddressSearch, formatDistance } from "@/components/address-search";
import { Button } from "@/components/ui";
import { circleRing, ringAreaM2 } from "@/lib/geo";
import type { Ring } from "@/lib/geo-simplify";
import { GEOFENCE_LIMITS } from "@/lib/geofence/submission";
import { InfoButton } from "@/components/info-button";
import { fmtSqMiles, MILE_M, SQ_MILE_M2, TIER_META, TIER_RULES, type Tier, type WideMode } from "@/lib/geofence/tiers";

export type DrawnShape =
  | { type: "circle"; center: { lat: number; lng: number }; radius_m: number }
  | { type: "polygon"; vertices: { lat: number; lng: number }[] }
  /** A named place's real outline (town, county, island, country). */
  | { type: "boundary"; name: string; geojson: { type: "Polygon" | "MultiPolygon"; coordinates: Ring[] | Ring[][] } }
  /** Anywhere more than distance_m from home (home is never shown). */
  | { type: "beyond_home"; distance_m: number }
  /** A watcher's location (home, work, a venue): blurred by the server. */
  | { type: "location"; center: { lat: number; lng: number }; radius_m: number };

const MILE = 1609.344;
/** Distances offered for "anywhere beyond home". */
const BEYOND_OPTIONS = [1, 2, 5, 10, 25, 50, 100].map((mi) => ({ label: `${mi} mile${mi === 1 ? "" : "s"}`, m: Math.round(mi * MILE) }));

/** Outline parts as [outer, ...holes][] for drawing and area. */
function boundaryParts(s: Extract<DrawnShape, { type: "boundary" }>): Ring[][] {
  return (s.geojson.type === "Polygon" ? [s.geojson.coordinates] : s.geojson.coordinates) as Ring[][];
}

// Radius slider on a log scale: fine control for small circles, up to 1,000 km.
const SLIDER_STEPS = 1000;
const MAX_R = GEOFENCE_LIMITS.maxRadiusM;
const toRadius = (v: number, min: number) => {
  const r = min * (MAX_R / min) ** (v / SLIDER_STEPS);
  return Math.max(min, r < 1000 ? Math.round(r / 5) * 5 : r < 10_000 ? Math.round(r / 50) * 50 : Math.round(r / 500) * 500);
};
const toSlider = (r: number, min: number) => Math.round((Math.log(Math.max(r, min) / min) / Math.log(MAX_R / min)) * SLIDER_STEPS);

/** Smallest circle radius offered for each kind of area. */
const LOCAL_MIN_RADIUS_M = TIER_RULES.localMinRadiusM;
const minRadiusFor = (tier?: Tier) =>
  tier === "wide" ? TIER_RULES.wideMinRadiusM : tier === "local" ? LOCAL_MIN_RADIUS_M : GEOFENCE_LIMITS.minRadiusM;

const fmtArea = (m2: number) =>
  m2 >= 0.5 * SQ_MILE_M2
    ? `${fmtSqMiles(m2)} (${(m2 / 1e6).toFixed(m2 >= 1e8 ? 0 : 1)} km²)`
    : m2 >= 1e6
      ? `${(m2 / 1e6).toFixed(2)} km²`
      : `${Math.round(m2).toLocaleString()} m²`;

interface Props {
  value: DrawnShape | null;
  onChange: (s: DrawnShape | null) => void;
  /** Read-only context features (e.g. existing geofences, or the watcher's other areas). */
  context?: MapFeature[];
  /** Watch areas: which kind is being drawn (sets the minimum sizes and options). */
  tier?: Tier;
  wideMode?: WideMode;
}

export function GeofenceDrawer(props: Props) {
  if (props.tier === "location") {
    return <LocationPicker value={props.value?.type === "location" ? props.value : null} onChange={props.onChange} context={props.context ?? []} />;
  }
  return <AreaDrawer {...props} />;
}

function AreaDrawer({ value, onChange, context = [], tier, wideMode }: Props) {
  const minR = minRadiusFor(tier);
  const color = tier ? TIER_META[tier].color : "#b45309";
  // Beyond home is only offered for "don't go outside" wide areas (and admins).
  const offerBeyond = !tier || (tier === "wide" && wideMode === "outside");
  const [mode, setMode] = useState<"circle" | "polygon">(value?.type === "polygon" ? "polygon" : "circle");
  const [radius, setRadius] = useState(Math.max(minR, value?.type === "circle" ? value.radius_m : 200));

  const ring = useMemo<[number, number][] | null>(() => {
    if (!value) return null;
    if (value.type === "circle") return circleRing(value.center, value.radius_m);
    if (value.type === "boundary" || value.type === "beyond_home" || value.type === "location") return null;
    if (value.vertices.length < 3) return null;
    const r = value.vertices.map((v) => [v.lng, v.lat] as [number, number]);
    return [...r, r[0]];
  }, [value]);

  const draft = useMemo<MapFeature[]>(() => {
    const f: MapFeature[] = [];
    if (ring) f.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { color, opacity: 0.25 } });
    if (value?.type === "boundary") f.push({ type: "Feature", geometry: value.geojson as MapFeature["geometry"], properties: { color, opacity: 0.25 } });
    if (value?.type === "polygon") {
      for (const v of value.vertices) {
        f.push({ type: "Feature", geometry: { type: "Point", coordinates: [v.lng, v.lat] }, properties: { color, size: 5 } });
      }
    }
    if (value?.type === "circle") {
      f.push({ type: "Feature", geometry: { type: "Point", coordinates: [value.center.lng, value.center.lat] }, properties: { color, size: 5 } });
    }
    return f;
  }, [ring, value, color]);

  const area =
    value?.type === "boundary"
      ? boundaryParts(value).reduce((s, p) => s + ringAreaM2(p[0]) - p.slice(1).reduce((h, r) => h + ringAreaM2(r), 0), 0)
      : ring
        ? ringAreaM2(ring)
        : 0;

  function onMapClick(p: { lat: number; lng: number }) {
    if (mode === "circle") onChange({ type: "circle", center: p, radius_m: Math.max(minR, radius) });
    else {
      const vertices = value?.type === "polygon" ? value.vertices : [];
      if (vertices.length >= GEOFENCE_LIMITS.maxVertices) return;
      onChange({ type: "polygon", vertices: [...vertices, p] });
    }
  }

  function switchMode(m: "circle" | "polygon") {
    setMode(m);
    onChange(null);
  }

  const beyond = offerBeyond && value?.type === "beyond_home";
  const beyondPanel = (
    <fieldset className="space-y-2 rounded-xl border border-border p-3">
      <legend className="px-1 text-sm font-semibold">Or: anywhere beyond home</legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={beyond}
          onChange={(e) => onChange(e.target.checked ? { type: "beyond_home", distance_m: BEYOND_OPTIONS[1].m } : null)}
        />
        <span>
          {tier ? (
            <>
              Instead of a place: <strong>more than a set distance from my home</strong>
            </>
          ) : (
            <>
              Watch <strong>everywhere</strong> more than a set distance from my home.
            </>
          )}
        </span>
      </label>
      {beyond && (
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Distance from home:</span>
          <select
            className="h-10 rounded-lg border border-border bg-surface px-2"
            value={value.distance_m}
            onChange={(e) => onChange({ type: "beyond_home", distance_m: Number(e.target.value) })}
          >
            {BEYOND_OPTIONS.map((o) => (
              <option key={o.m} value={o.m}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {tier && (
        <InfoButton>
          <p>The circle is centred near my home, shifted at random by up to 1 km. My home area is shown on the maps; movement inside it never is.</p>
        </InfoButton>
      )}
    </fieldset>
  );
  if (beyond) return <div className="space-y-3">{beyondPanel}</div>;

  return (
    <div className="space-y-3">
      {offerBeyond && beyondPanel}
      <AddressSearch
        id="area-search"
        label="Find the place (postcode, address or place name)"
        placeholder="e.g. SW1A 1AA, 10 High Street Leeds, or South Yorkshire"
        onSelect={(r) => {
          // Named places (towns, counties, islands, countries) use their real
          // outline. Addresses and postcodes get a small circle.
          if (r.boundary) {
            setMode("circle");
            onChange({ type: "boundary", name: r.name, geojson: r.boundary });
            return;
          }
          const radiusM = Math.min(GEOFENCE_LIMITS.maxRadiusM, Math.max(minR, Math.round(r.enclosingRadiusM ?? 100)));
          setMode("circle");
          setRadius(radiusM);
          onChange({ type: "circle", center: { lat: r.lat, lng: r.lng }, radius_m: radiusM });
        }}
      />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Shape">
        <Button type="button" size="sm" variant={mode === "circle" && value?.type !== "boundary" ? "primary" : "secondary"} onClick={() => switchMode("circle")} aria-pressed={mode === "circle" && value?.type !== "boundary"}>
          Circle
        </Button>
        <Button type="button" size="sm" variant={mode === "polygon" ? "primary" : "secondary"} onClick={() => switchMode("polygon")} aria-pressed={mode === "polygon"}>
          Polygon
        </Button>
        {value?.type === "boundary" && (
          <span className="text-sm font-medium">Outline of {value.name || "the place"}</span>
        )}
        {value?.type === "polygon" && value.vertices.length > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(value.vertices.length > 1 ? { type: "polygon", vertices: value.vertices.slice(0, -1) } : null)}>
            Undo point
          </Button>
        )}
        {value && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-sm text-muted">
        {value?.type === "boundary"
          ? "Using the place's real boundary. Click the map, or choose Circle or Polygon, to draw your own instead."
          : mode === "circle"
          ? "Search above (a town, county, island or country uses its real boundary), or click the map to place a circle's centre."
          : `Click the map to add corners (at least 3, up to ${GEOFENCE_LIMITS.maxVertices}).`}
      </p>
      {mode === "circle" && value?.type !== "boundary" && (
        <label className="flex items-center gap-3 text-sm">
          <span className="w-40 font-medium">Radius: {formatDistance(radius)}</span>
          <input
            type="range"
            min={0}
            max={SLIDER_STEPS}
            step={1}
            value={toSlider(radius, minR)}
            aria-valuetext={formatDistance(radius)}
            onChange={(e) => {
              const r = toRadius(Number(e.target.value), minR);
              setRadius(r);
              if (value?.type === "circle") onChange({ ...value, radius_m: r });
            }}
            className="flex-1"
          />
        </label>
      )}
      <LazyMap features={context} draft={draft} fitDraft onMapClick={onMapClick} fit={context.length > 0 ? "once" : false} className="h-[55vh] min-h-72 w-full" ariaLabel="Draw an area" />
      {(ring || value?.type === "boundary") && (
        <p className="text-xs text-muted">
          Area ≈ {fmtArea(area)}
          {area > GEOFENCE_LIMITS.maxAreaM2 && <span className="font-semibold text-red-700"> (too large)</span>}
          {tier === "wide" && value?.type === "boundary" && area < TIER_RULES.wideMinPlaceM2 && (
            <span className="font-semibold text-red-700"> (too small for a Wish area: use a town or larger)</span>
          )}
          {tier === "wide" && value?.type === "polygon" && area < TIER_RULES.wideMinShapeM2 && (
            <span className="font-semibold text-red-700"> (too small: at least {fmtSqMiles(TIER_RULES.wideMinShapeM2)})</span>
          )}
          {tier === "local" && area < TIER_RULES.localMinM2 * 0.995 && (
            <span className="font-semibold text-red-700"> (too small: a Want area needs at least {fmtSqMiles(TIER_RULES.localMinM2)})</span>
          )}
        </p>
      )}
    </div>
  );
}

// From a single building to 50 miles.
const LOCATION_RADII = [25, 50, 100, 250, 500, 1000, 2000, 5000, ...[5, 10, 20, 30, 50].map((mi) => Math.round(mi * MILE_M))];

/** Pick a location (search or tap the map) and how far around it to watch. */
function LocationPicker({
  value,
  onChange,
  context,
}: {
  value: Extract<DrawnShape, { type: "location" }> | null;
  onChange: (s: DrawnShape | null) => void;
  context: MapFeature[];
}) {
  const [radius, setRadius] = useState(value?.radius_m ?? 250);
  const color = TIER_META.location.color;
  const draft = useMemo<MapFeature[]>(
    () =>
      value
        ? [
            { type: "Feature", geometry: { type: "Polygon", coordinates: [circleRing(value.center, value.radius_m)] }, properties: { color, opacity: 0.25 } },
            { type: "Feature", geometry: { type: "Point", coordinates: [value.center.lng, value.center.lat] }, properties: { color, size: 6 } },
          ]
        : [],
    [value, color],
  );
  return (
    <div className="space-y-3">
      <AddressSearch
        id="location-search"
        label="Find the place (postcode, address or venue)"
        placeholder="e.g. S10 2JF, or Sheffield City Hall"
        onSelect={(r) => onChange({ type: "location", center: { lat: r.lat, lng: r.lng }, radius_m: radius })}
      />
      <p className="text-sm text-muted">Or tap the map to place it.</p>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Watch within</span>
        <select
          className="h-10 rounded-lg border border-border bg-surface px-2"
          value={radius}
          onChange={(e) => {
            const r = Number(e.target.value);
            setRadius(r);
            if (value) onChange({ ...value, radius_m: r });
          }}
        >
          {[...new Set([...LOCATION_RADII, radius])].sort((a, b) => a - b).map((m) => (
            <option key={m} value={m}>
              {formatDistance(m)}
            </option>
          ))}
        </select>
        <span className="text-muted">of it</span>
      </label>
      <LazyMap
        features={context}
        draft={draft}
        fitDraft
        fit={context.length > 0 ? "once" : false}
        onMapClick={(p) => onChange({ type: "location", center: p, radius_m: radius })}
        className="h-[45vh] min-h-64 w-full"
        ariaLabel="Choose a location"
      />
      <InfoButton label="How it stays private">
        <p>
          It&apos;s saved as a circle with twice the radius ({formatDistance(radius * 2)}), placed at random so your {formatDistance(radius)} always
          sits inside it.          Only you, with this link, can see it.
        </p>
      </InfoButton>
    </div>
  );
}
