"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { Icon, OnTheMove, StatusDisk, StatusLegend } from "@/components/design";
import { LIVE_STATUS_META, PUBLIC_LABELS, PUBLIC_STATES, WATCH_LABELS, WATCH_STATES } from "@/lib/live-status";
import { gridCellRing } from "@/lib/geo";
import { fmtDateTime, relativeAge } from "@/lib/format";
import { forgetWatchLink, loadWatchLinks } from "@/lib/watch-links";
import { useNow } from "@/lib/use-now";
import type { PublicLiveStatus } from "@/lib/public-data";


type StatusKey = keyof typeof LIVE_STATUS_META;

interface Shown {
  status: StatusKey;
  public_lat: number | null;
  public_lng: number | null;
  cell_size_m: number | null;
  observed_at: string | null;
  status_since: string | null;
  moving: boolean;
}

interface WatcherInfo {
  token: string;
  display_code: string | null;
  areaCount: number;
}

/**
 * Live status. Visitors see the home-based colour (green / yellow / grey).
 * If this device has a saved watch link (kept in this browser's storage, not
 * a cookie), the card shows that watcher's own view instead: amber, red or
 * purple for their areas, labelled with their random watcher number.
 */
export function LiveStatusCard({ initial }: { initial: PublicLiveStatus }) {
  const [pub, setPub] = useState(initial);
  const now = useNow();
  const [watch, setWatch] = useState<(Shown & WatcherInfo) | null>(null);

  const loadWatcher = useCallback(async () => {
    let token = loadWatchLinks()[0]?.token;
    if (!token) return;
    try {
      let r = await fetch(`/api/watch/${token}`, { cache: "no-store" });
      if (!r.ok) return setWatch(null);
      let v = await r.json();
      if (v.is_sample) {
        // The public sample was saved on this device by mistake: forget it, use the next link.
        forgetWatchLink(token);
        token = loadWatchLinks()[0]?.token;
        if (!token) return setWatch(null);
        r = await fetch(`/api/watch/${token}`, { cache: "no-store" });
        if (!r.ok) return setWatch(null);
        v = await r.json();
      }
      if (!v.enabled) return setWatch(null);
      setWatch({
        token,
        display_code: v.display_code ?? null,
        areaCount: v.areas?.length ?? 0,
        status: v.status,
        public_lat: v.public_lat,
        public_lng: v.public_lng,
        cell_size_m: v.cell_size_m,
        observed_at: v.observed_at,
        status_since: null,
        moving: Boolean(v.moving),
      });
    } catch {
      /* fall back to the public view */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWatcher();
    const t = setInterval(async () => {
      try {
        const r = await fetch("/api/public/live", { cache: "no-store" });
        if (r.ok) setPub(await r.json());
      } catch {
        /* keep last known */
      }
      void loadWatcher();
    }, 60_000);
    return () => clearInterval(t);
  }, [loadWatcher]);

  const s: Shown =
    watch ??
    ({
      status: pub.status,
      public_lat: pub.public_lat,
      public_lng: pub.public_lng,
      cell_size_m: pub.cell_size_m,
      observed_at: pub.observed_at,
      status_since: pub.status_since,
      moving: Boolean(pub.moving),
    } as Shown);
  const status = s.status;
  const meta = LIVE_STATUS_META[status] ?? LIVE_STATUS_META.unknown;
  const label = (watch ? WATCH_LABELS[status as keyof typeof WATCH_LABELS] : PUBLIC_LABELS[status as keyof typeof PUBLIC_LABELS]) || meta.label;
  const cellKm = ((s.cell_size_m ?? 1000) / 1000).toFixed(s.cell_size_m && s.cell_size_m < 1000 ? 2 : 1);

  const features = useMemo<MapFeature[]>(() => {
    if (s.public_lat == null || s.public_lng == null) return [];
    const c = { lat: s.public_lat, lng: s.public_lng };
    return [
      { type: "Feature", geometry: { type: "Polygon", coordinates: [gridCellRing(c, s.cell_size_m ?? 1000)] }, properties: { color: meta.color, opacity: 0.2, dashed: true } },
      { type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { color: meta.color, size: 10, label: `${label}\nApproximate area (about ${cellKm} km square)` } },
    ];
  }, [s.public_lat, s.public_lng, s.cell_size_m, meta.color, label, cellKm]);

  if (pub.status === "disabled" && !watch) {
    return (
      <section id="status" className="rounded-[var(--ft-radius-card)] border border-border bg-surface p-6 shadow-[var(--ft-shadow-card)]">
        <p className="text-xs font-bold uppercase tracking-[.08em] text-muted">Live status</p>
        <p className="mt-2 text-lg font-semibold">The live marker is switched off at the moment.</p>
        <p className="mt-1 text-sm text-muted">History and plans are still available.</p>
      </section>
    );
  }

  const moving = s.moving && status !== "unknown";
  // FollowMee is silent while the phone is still: an older last reading means "staying put".
  const stillSince = !moving && status !== "unknown" && now && s.observed_at && now - Date.parse(s.observed_at) > 10 * 60_000 ? s.observed_at : null;

  return (
    <section
      id="status"
      aria-live="polite"
      className="scroll-mt-24 space-y-5 rounded-[var(--ft-radius-card)] border border-border bg-surface p-[18px] shadow-[var(--ft-shadow-card)] sm:p-7"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-bold uppercase tracking-[.08em] text-muted">
          {watch ? `Your view${watch.display_code ? ` · Watcher #${watch.display_code}` : ""}` : "Live status"}
        </span>
        <span className="text-muted">Refreshes every minute</span>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="sm:hidden"><StatusDisk status={status} size={50} /></span>
        <span className="hidden sm:inline-flex"><StatusDisk status={status} size={64} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[26px] font-bold leading-tight sm:text-[32px]">{label}</h2>
          <p className="text-sm text-muted tabular-nums">
            {s.status_since && status !== "unknown" ? `Since ${fmtDateTime(s.status_since)}` : meta.description}
          </p>
          {stillSince && <p className="text-sm text-muted tabular-nums">Not moved since {fmtDateTime(stillSince)} ({relativeAge(stillSince)})</p>}
        </div>
        {moving && <OnTheMove status={status} />}
      </div>

      {features.length > 0 ? (
        <div className="relative h-[240px] overflow-hidden rounded-[14px] sm:h-[280px]">
          <LazyMap features={features} className="h-full w-full" initialZoom={12} ariaLabel={`Map: approximate area, ${label}${moving ? ", on the move" : ""}`} />
          <span className="pointer-events-none absolute left-3 top-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-white/95 px-3 text-xs font-medium">
            <Icon name="pin" className="h-4 w-4 text-accent" /> Approximate area · about {cellKm} km square
          </span>
        </div>
      ) : status === "unknown" ? (
        <div className="flex h-[140px] items-center gap-3 rounded-[14px] border-2 border-dashed border-[#B8C6D4] bg-[#F7FAFD] p-5 text-sm text-muted">
          <Icon name="dash" className="h-6 w-6" />
          <p>
            <strong className="text-ink">No recent GPS update.</strong> The phone may be idle, charging or out of signal. This
            is not by itself a cause for concern.
          </p>
        </div>
      ) : (
        <div className="flex h-[140px] items-center gap-3 rounded-[14px] bg-mint p-5 text-sm text-[#005843]">
          <Icon name="lock" className="h-6 w-6" />
          <p>
            <strong>Position not shown near home.</strong>{" "}
            {moving ? "On the move: the marker appears once I'm a short distance away." : "The marker reappears once I'm a short distance away."}
          </p>
        </div>
      )}

      {watch ? (
        <StatusLegend states={[...WATCH_STATES]} current={status} labels={WATCH_LABELS} />
      ) : (
        <StatusLegend states={[...PUBLIC_STATES]} current={status as (typeof PUBLIC_STATES)[number]} labels={PUBLIC_LABELS} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-4 text-sm">
        <span className="text-muted tabular-nums">
          {s.observed_at ? `Last GPS update ${relativeAge(s.observed_at)} · ${fmtDateTime(s.observed_at)}` : "No GPS update yet"}
        </span>
        {watch ? (
          <Link href={`/watch/${watch.token}`} className="font-semibold text-accent hover:underline">
            My watch view ({watch.areaCount} area{watch.areaCount === 1 ? "" : "s"}) →
          </Link>
        ) : (
          <Link href="/geofences/submit" className="font-semibold text-accent hover:underline">
            Watch your own areas →
          </Link>
        )}
      </div>
    </section>
  );
}
