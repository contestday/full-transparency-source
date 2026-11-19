"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useEffect, useRef, useState } from "react";
import { MAP_STYLE_URL } from "@/lib/env";

export interface MapFeatureProps {
  /** Colour for the feature (CSS colour). */
  color?: string;
  /** Plain-text popup content (rendered as text, never HTML). */
  label?: string;
  /** Dashed outline, used for unverified submissions. */
  dashed?: boolean;
  /** Circle radius in pixels for point features. */
  size?: number;
  opacity?: number;
  /** A number drawn on a point (matches a numbered card in a list). */
  num?: number;
}

export type MapFeature = Feature<Geometry, MapFeatureProps>;

interface Props {
  features: MapFeature[];
  /** Drawing overlay (e.g. in-progress geofence). */
  draft?: MapFeature[];
  onMapClick?: (p: { lat: number; lng: number }) => void;
  className?: string;
  /** Fit to features when they change (true, the default), or only the first time ("once"). */
  fit?: boolean | "once";
  /** Zoom to the draft overlay whenever its position changes (e.g. after an address search). */
  fitDraft?: boolean;
  /** Zoom to these features whenever `key` changes (e.g. tapping an area in a list). */
  focus?: { key: number; features: MapFeature[] } | null;
  /**
   * Points (e.g. the middle of each area) counted in white number markers when
   * zoomed out, so a busy map still shows how many areas are where. Hidden once
   * zoomed in far enough to see the areas themselves.
   */
  countPoints?: { lat: number; lng: number }[];
  initialCenter?: [number, number];
  initialZoom?: number;
  ariaLabel?: string;
}

// Served from public/ (copied by scripts/copy-maplibre-worker.mjs on install).
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function addLayers(map: MLMap, id: string) {
  map.addSource(id, { type: "geojson", data: EMPTY });
  const color = ["coalesce", ["get", "color"], "#1d4ed8"] as unknown as string;
  map.addLayer({
    id: `${id}-fill`,
    type: "fill",
    source: id,
    filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
    paint: { "fill-color": color, "fill-opacity": ["coalesce", ["get", "opacity"], 0.18] as unknown as number },
  });
  map.addLayer({
    id: `${id}-outline`,
    type: "line",
    source: id,
    filter: ["all", ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]], ["!=", ["get", "dashed"], true]],
    paint: { "line-color": color, "line-width": 2 },
  });
  map.addLayer({
    id: `${id}-outline-dashed`,
    type: "line",
    source: id,
    filter: ["all", ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]], ["==", ["get", "dashed"], true]],
    paint: { "line-color": color, "line-width": 2, "line-dasharray": [2, 2] },
  });
  map.addLayer({
    id: `${id}-line`,
    type: "line",
    source: id,
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": color, "line-width": 3, "line-opacity": 0.8 },
  });
  map.addLayer({
    id: `${id}-point`,
    type: "circle",
    source: id,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-color": color,
      "circle-radius": ["coalesce", ["get", "size"], 6] as unknown as number,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  // Numbers on numbered pins.
  map.addLayer({
    id: `${id}-num`,
    type: "symbol",
    source: id,
    filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "num"]],
    layout: { "text-field": ["to-string", ["get", "num"]] as unknown as string, "text-font": ["Noto Sans Bold"], "text-size": 12, "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#ffffff" },
  });
}

/** Zoom level from which the areas themselves are clear and the counts are hidden. */
const COUNTS_MAX_ZOOM = 11;

function addCountLayers(map: MLMap) {
  map.addSource("counts", { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 50, clusterMaxZoom: 22 });
  const count = ["coalesce", ["get", "point_count"], 1] as unknown as number;
  map.addLayer({
    id: "counts-circle",
    type: "circle",
    source: "counts",
    maxzoom: COUNTS_MAX_ZOOM,
    paint: { "circle-color": "#ffffff", "circle-radius": ["step", count, 13, 10, 16, 50, 19] as unknown as number, "circle-stroke-color": "#142B49", "circle-stroke-width": 2 },
  });
  map.addLayer({
    id: "counts-label",
    type: "symbol",
    source: "counts",
    maxzoom: COUNTS_MAX_ZOOM,
    layout: { "text-field": ["to-string", count] as unknown as string, "text-font": ["Noto Sans Bold"], "text-size": 13, "text-allow-overlap": true },
    paint: { "text-color": "#142B49" },
  });
}

function boundsOf(features: MapFeature[]): maplibregl.LngLatBounds | null {
  const b = new maplibregl.LngLatBounds();
  let any = false;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      b.extend(c as [number, number]);
      any = true;
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  for (const f of features) {
    if (f.geometry && "coordinates" in f.geometry) visit(f.geometry.coordinates);
  }
  return any ? b : null;
}

export function MapView({
  features,
  draft,
  onMapClick,
  className,
  fit = true,
  fitDraft = false,
  focus = null,
  countPoints,
  initialCenter = [-2.5, 54.0],
  initialZoom = 5,
  ariaLabel = "Map",
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clickRef = useRef(onMapClick);
  const fittedRef = useRef(false);
  useEffect(() => {
    clickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    if (!container.current) return;
    let map: MLMap;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE_URL,
        center: initialCenter,
        zoom: initialZoom,
        attributionControl: { compact: true },
      });
    } catch {
      // WebGL unavailable (old device, headless test browser).
      queueMicrotask(() => setError("The interactive map could not be displayed on this device."));
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      addLayers(map, "data");
      addLayers(map, "draft");
      addCountLayers(map);
      setLoaded(true);
    });
    map.on("error", (e) => console.warn("map error", e.error?.message));
    map.on("click", (e: MapMouseEvent) => {
      const count = map.getLayer("counts-circle") ? map.queryRenderedFeatures(e.point, { layers: ["counts-circle"] })[0] : undefined;
      if (count && count.geometry.type === "Point") {
        map.easeTo({ center: count.geometry.coordinates as [number, number], zoom: Math.min(COUNTS_MAX_ZOOM, map.getZoom() + 2) });
        return;
      }
      const hits = map.queryRenderedFeatures(e.point, {
        layers: ["data-point", "data-fill", "data-line"].filter((l) => map.getLayer(l)),
      });
      const label = hits.find((h) => h.properties?.label)?.properties?.label;
      if (label && !clickRef.current) {
        const el = document.createElement("div");
        el.className = "text-sm whitespace-pre-line max-w-60";
        el.textContent = String(label);
        new maplibregl.Popup({ closeButton: true }).setLngLat(e.lngLat).setDOMContent(el).addTo(map);
      }
      clickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    map.on("mousemove", (e) => {
      const interactive = ["data-point", "data-fill"].filter((l) => map.getLayer(l));
      const hit = interactive.length ? map.queryRenderedFeatures(e.point, { layers: interactive }).length > 0 : false;
      map.getCanvas().style.cursor = clickRef.current ? "crosshair" : hit ? "pointer" : "";
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource("data") as GeoJSONSource).setData({ type: "FeatureCollection", features });
    if (fit === true || (fit === "once" && !fittedRef.current)) {
      const b = boundsOf(features);
      if (b) {
        map.fitBounds(b, { padding: 40, maxZoom: 15, duration: 0 });
        fittedRef.current = true;
      }
    }
  }, [features, loaded, fit]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource("draft") as GeoJSONSource).setData({ type: "FeatureCollection", features: draft ?? [] });
    if (fitDraft && draft?.length) {
      const b = boundsOf(draft);
      if (b) map.fitBounds(b, { padding: 40, maxZoom: 16, duration: 400 });
    }
  }, [draft, loaded, fitDraft]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource("counts") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: (countPoints ?? []).map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: {} })),
    });
  }, [countPoints, loaded]);

  const focusKey = focus?.key;
  const focusFeatures = focus?.features;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !focusFeatures?.length) return;
    const b = boundsOf(focusFeatures);
    if (b) map.fitBounds(b, { padding: 40, maxZoom: 15, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, loaded]);

  return (
    <div className={className ?? "h-96 w-full"}>
      {error ? (
        <div className="flex h-full items-center justify-center rounded-lg border border-border bg-slate-100 p-4 text-sm text-muted">
          {error}
        </div>
      ) : (
        <div ref={container} className="h-full w-full overflow-hidden rounded-lg border border-border" role="region" aria-label={ariaLabel} />
      )}
    </div>
  );
}
