"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { loadWatchLinks } from "@/lib/watch-links";
import type { WatchZone } from "@/lib/geofence/tiers";

type Zones = Record<string, WatchZone | null>;
const Ctx = createContext<Zones>({});

/**
 * If this device has a watch link saved, ask the server which of these points
 * fall in that watcher's own areas, so cards can show the watcher's colours.
 * Nothing is fetched (and nothing shown) for visitors without a watch link.
 */
export function WatchZonesProvider({ points, token: givenToken, children }: { points: { id: string; lat: number; lng: number; at?: number }[]; token?: string; children: ReactNode }) {
  const [zones, setZones] = useState<Zones>({});
  const key = points.map((p) => p.id).join(",");
  useEffect(() => {
    const token = givenToken ?? loadWatchLinks()[0]?.token;
    if (!token || !points.length) return;
    let cancelled = false;
    fetch(`/api/watch/${token}/zones`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ points: points.slice(0, 1000) }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!cancelled && b?.zones) setZones(b.zones);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, givenToken]);
  return <Ctx.Provider value={zones}>{children}</Ctx.Provider>;
}

/** The watcher's own colour for this card, if this device has a watch link and the place is in one of their areas. */
export function useWatchZone(id: string | undefined): WatchZone | null {
  const zones = useContext(Ctx);
  return id ? (zones[id] ?? null) : null;
}
