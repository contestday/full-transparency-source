"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/design";
import { Notice } from "@/components/ui";
import { loadWatchLinks } from "@/lib/watch-links";
import type { PublicHistoryRecord } from "@/lib/public-data";
import type { BaseZone, WatchZone, Zone } from "@/lib/geofence/tiers";
import { HistoryView } from "../history-view";

interface Data {
  records: PublicHistoryRecord[];
  route: { zone: Zone; coords: [number, number][] }[];
  stopZones: Record<string, BaseZone>;
  watchZones: Record<string, WatchZone | null>;
  areaCount: number;
  home_area?: { lat: number; lng: number; radius_m: number } | null;
}

/** Loads the history coloured for the watch link saved on this device. */
export function WatchedHistory({ from, to, token: givenToken }: { from: string; to: string; token?: string }) {
  const [state, setState] = useState<"loading" | "nolink" | "error" | "ready">("loading");
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    const token = givenToken ?? loadWatchLinks()[0]?.token;
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("nolink");
      return;
    }
    let cancelled = false;
    setState("loading");
    fetch(`/api/watch/${token}/history?from=${from}&to=${to}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d: Data) => {
        if (cancelled) return;
        setData(d);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [from, to, givenToken]);

  if (state === "nolink") {
    return (
      <EmptyState icon="eye" title="No watch link on this device.">
        Your History shows my history in the colours of your own areas. <Link className="text-accent underline" href="/geofences/submit">Set up an area</Link>, or
        open your private watch link on this device once, then come back. Or look at the <Link className="text-accent underline" href="/history">public history</Link>.
      </EmptyState>
    );
  }
  if (state === "error") return <Notice tone="red">Your watched history could not be loaded. Please try again later.</Notice>;
  if (state === "loading" || !data) return <p className="text-sm text-muted">Loading your watched history…</p>;
  return (
    <>
      {!data.areaCount && <Notice tone="blue">Your watch link has no areas yet, so this matches the public history.</Notice>}
      <HistoryView records={data.records} route={data.route} stopZones={data.stopZones} watchZones={data.watchZones} homeArea={data.home_area ?? null} />
    </>
  );
}
