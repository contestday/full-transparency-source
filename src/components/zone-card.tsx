"use client";

import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { useWatchZone } from "@/components/watch-zones";
import { BASE_ZONE_LABEL, WATCH_ZONE_LABEL, ZONE_COLOR, type BaseZone, type WatchZone } from "@/lib/geofence/tiers";

const INK = "#142B49";

/** Text colour that reads on a solid zone colour (dark on yellow). */
export const onZone = (zone: string | null) => (zone === "yellow" || !zone ? INK : "#fff");

/** One colour per card: the watcher's own colour if it applies, otherwise everyone's. */
export function cardColour(base: BaseZone | null, watch: WatchZone | null): { key: string | null; color: string; label: string | null } {
  if (watch) return { key: watch, color: ZONE_COLOR[watch], label: WATCH_ZONE_LABEL[watch] };
  if (base) return { key: base, color: ZONE_COLOR[base], label: BASE_ZONE_LABEL[base] };
  return { key: null, color: "#C5D6E5", label: null };
}

/**
 * A card shaded by where it is: a hard-coloured title bar, a soft tint of the
 * same colour behind the details, and a hard border. Everyone sees green
 * (okay zone), yellow (outside it) or red (my noted areas). A watcher
 * whose own area it is sees only their colour instead (amber, red or purple).
 */
export function ZoneCard({
  zone,
  watchId,
  title,
  aside,
  children,
  className,
  muted = false,
}: {
  zone: BaseZone | null;
  /** Look up this card's watcher colour (inside a WatchZonesProvider). */
  watchId?: string;
  title: ReactNode;
  /** Small items at the right of the title bar (e.g. a status badge). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  muted?: boolean;
}) {
  const c = cardColour(zone, useWatchZone(watchId));
  return (
    <article
      className={cn("overflow-hidden rounded-[var(--ft-radius-card)] border-2 shadow-[var(--ft-shadow-card)]", muted && "opacity-75", className)}
      style={{ borderColor: c.color, background: c.key ? `color-mix(in srgb, ${c.color} 9%, #fff)` : "#fff" }}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5" style={{ background: c.key ? c.color : "#E6EEF7", color: onZone(c.key) }}>
        <div className="min-w-0 flex-1 basis-48">{title}</div>
        <div className="flex flex-wrap items-center gap-2">
          {c.label && <span className="text-xs font-semibold">{c.label}</span>}
          {aside}
        </div>
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </article>
  );
}
