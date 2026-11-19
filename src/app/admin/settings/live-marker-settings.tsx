"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { AddressSearch, formatDistance } from "@/components/address-search";
import { Badge, Button, Card, Field, Input, Notice } from "@/components/ui";
import { api } from "@/lib/client-api";
import { circleRing } from "@/lib/geo";
import { DEFAULT_HOME_RADIUS_M, LIVE_STATUS_META, type LiveStatus } from "@/lib/live-status";
import type { PublicationRuleRow } from "@/lib/publication";

type Rule = PublicationRuleRow & { id: string };
const M_PER_MILE = 1609.344;
const HOME_LABEL = "Home";

/**
 * Home set-up, in one place:
 *   hidden zone   (default 250 m) never shown anywhere publicly
 *   okay zone     (default 3 mi)  marker green, position visible
 *   beyond        marker yellow
 * Areas of concern submitted by others turn the marker red / purple.
 */
export function LiveMarkerSettings({ rules, currentStatus }: { rules: Rule[]; currentStatus: LiveStatus }) {
  const router = useRouter();
  const homeRule = rules.find((r) => r.rule_type === "home_range");
  const liveRule = rules.find((r) => r.rule_type === "live_status");
  const hiddenRule = rules.find((r) => r.rule_type === "exclusion_zone" && r.configuration.label === HOME_LABEL);
  const hc = homeRule?.configuration as { lat?: number; lng?: number; radius_m?: number } | undefined;

  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(hc?.lat != null ? { lat: hc.lat, lng: hc.lng! } : null);
  const [placeLabel, setPlaceLabel] = useState<string>(homeRule ? "Saved home location" : "");
  const [miles, setMiles] = useState(((hc?.radius_m ?? DEFAULT_HOME_RADIUS_M) / M_PER_MILE).toFixed(1));
  const [hiddenM, setHiddenM] = useState(Number(hiddenRule?.configuration.radius_m ?? 250));
  const [gridM, setGridM] = useState(Number(liveRule?.configuration.grid_m ?? 250));
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const enabled = Boolean(liveRule?.enabled);
  const okayM = Math.round(Number(miles) * M_PER_MILE);
  // The public square containing a position must not overlap the hidden zone,
  // so the effective hidden distance is the zone plus half a square's diagonal.
  const effectiveHiddenM = Math.round(hiddenM + (gridM * Math.SQRT2) / 2);
  const saveBlocker = !center
    ? "Search for your home first."
    : !(hiddenM >= 100 && hiddenM <= 2000)
      ? "The hidden zone must be between 100 and 2,000 metres (200–250 m suits most homes)."
      : !(okayM > hiddenM)
        ? "The okay zone must be bigger than the hidden zone."
        : !(gridM >= 250)
          ? "Marker precision must be at least 250 metres."
          : null;

  const draft = useMemo<MapFeature[]>(
    () =>
      center
        ? [
            { type: "Feature", geometry: { type: "Polygon", coordinates: [circleRing(center, okayM, 96)] }, properties: { color: "#16a34a", opacity: 0.1, label: "Okay zone (green)" } },
            { type: "Feature", geometry: { type: "Polygon", coordinates: [circleRing(center, effectiveHiddenM, 48)] }, properties: { color: "#64748b", opacity: 0.15, dashed: true } },
            { type: "Feature", geometry: { type: "Polygon", coordinates: [circleRing(center, hiddenM, 48)] }, properties: { color: "#dc2626", opacity: 0.3, label: "Hidden zone" } },
          ]
        : [],
    [center, okayM, hiddenM, effectiveHiddenM],
  );

  async function saveRule(rule: { rule_type: string; configuration: Record<string, unknown> }, on: boolean, id?: string) {
    await api("/api/admin/publication/rules", { method: "POST", json: { id, enabled: on, rule } });
  }

  async function saveHome() {
    if (!center) return;
    setBusy(true);
    setMsg(null);
    try {
      await saveRule({ rule_type: "exclusion_zone", configuration: { lat: center.lat, lng: center.lng, radius_m: hiddenM, label: HOME_LABEL } }, true, hiddenRule?.id);
      await saveRule({ rule_type: "home_range", configuration: { lat: center.lat, lng: center.lng, radius_m: okayM } }, true);
      await saveRule({ rule_type: "live_status", configuration: { grid_m: gridM } }, enabled);
      setMsg({ tone: "green", text: "Home saved: hidden zone, okay zone and marker precision updated." });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleMarker() {
    setBusy(true);
    setMsg(null);
    try {
      await saveRule({ rule_type: "live_status", configuration: { grid_m: gridM } }, !enabled);
      setMsg({ tone: "green", text: enabled ? "Public marker turned off." : "Public marker turned on." });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Update failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Home and live marker</h2>
          <p className="text-sm text-muted">
            Your home is hidden. Within your okay zone the marker is <strong className="text-green-700">green</strong>, and
            outside it <strong className="text-amber-600">amber</strong>. Areas of concern turn it{" "}
            <strong className="text-red-700">red</strong>, or <strong className="text-purple-700">purple</strong> for an
            area inside another.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={enabled ? "green" : "neutral"}>{enabled ? "Public: ON" : "Public: OFF"}</Badge>
          <span className="flex items-center gap-1.5 text-sm">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: LIVE_STATUS_META[currentStatus].color }} />
            Now: {LIVE_STATUS_META[currentStatus].label}
          </span>
        </div>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <AddressSearch
            id="home-search"
            label="1. Find your home (postcode or address)"
            onSelect={(r) => {
              setCenter({ lat: r.lat, lng: r.lng });
              setPlaceLabel(r.label);
            }}
          />
          {placeLabel && <p className="text-xs text-muted">Selected: {placeLabel}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="2. Hidden zone (metres)" htmlFor="hidden-m" hint="Never shown publicly.">
              <Input id="hidden-m" type="number" min={100} max={2000} step={10} value={hiddenM} onChange={(e) => setHiddenM(Number(e.target.value))} />
            </Field>
            <Field label="3. Okay zone (miles)" htmlFor="home-miles" hint="Green inside, yellow outside.">
              <Input id="home-miles" type="number" min={0.5} max={30} step={0.1} value={miles} onChange={(e) => setMiles(e.target.value)} />
            </Field>
            <Field label="Marker precision (metres)" htmlFor="live-grid" hint="Public position snaps to squares this size. Minimum 250.">
              <Input id="live-grid" type="number" min={250} max={50000} step={50} value={gridM} onChange={(e) => setGridM(Number(e.target.value))} />
            </Field>
          </div>
          <p className="text-xs text-muted">
            In practice nothing is shown within about <strong>{formatDistance(effectiveHiddenM)}</strong> of home: the
            hidden zone plus half a marker square, so no published square ever contains your home. Smaller squares
            mean a tighter hidden area.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || saveBlocker !== null} onClick={saveHome}>
              {homeRule ? "Update home" : "Save home"}
            </Button>
            <Button variant={enabled ? "danger" : "primary"} disabled={busy || (!enabled && !homeRule)} onClick={toggleMarker}>
              {enabled ? "Turn public marker OFF" : "Turn public marker ON"}
            </Button>
          </div>
          {saveBlocker && <p className="text-xs text-red-700">{saveBlocker}</p>}
          {!homeRule && !saveBlocker && <p className="text-xs text-amber-800">Save your home first, then turn the public marker on.</p>}
        </div>
        <LazyMap
          features={[]}
          draft={draft}
          fitDraft
          fit={false}
          initialCenter={center ? [center.lng, center.lat] : undefined}
          initialZoom={center ? 11 : 5}
          className="h-80 w-full lg:h-full lg:min-h-80"
          ariaLabel="Home zones preview"
        />
      </div>
    </Card>
  );
}
