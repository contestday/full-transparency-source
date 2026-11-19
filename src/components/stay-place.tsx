"use client";

import { useEffect, useState } from "react";
import { osGridRef } from "@/lib/os-grid";

// One address lookup at a time (the server allows about one a second), cached for the visit.
const cache = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();
function addressOf(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  let p = cache.get(key);
  if (!p) {
    p = queue.then(() =>
      fetch(`/api/public/address?lat=${lat}&lng=${lng}`)
        .then((r) => (r.ok ? r.json() : { address: null }))
        .then((b: { address: string | null }) => b.address)
        .catch(() => null),
    );
    queue = p;
    cache.set(key, p);
  }
  return p;
}

/**
 * Where a published stay was: the address (for an exact position), its
 * coordinates and OS grid reference. An approximate stay (a published square)
 * shows the square's middle and size instead of an address.
 */
export function StayPlace({ lat, lng, cellSizeM, label }: { lat: number; lng: number; cellSizeM: number; label?: string | null }) {
  const exact = cellSizeM === 0;
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    if (!exact) return;
    let live = true;
    addressOf(lat, lng).then((a) => live && setAddress(a));
    return () => {
      live = false;
    };
  }, [lat, lng, exact]);
  const grid = osGridRef(lat, lng);
  return (
    <span className="block text-xs text-muted">
      {exact ? (address ?? label ?? "Looking up the address…") : `${label ? `${label} · ` : ""}approximate: within a ${cellSizeM} m square`}
      <span className="block tabular-nums">
        {lat.toFixed(5)}, {lng.toFixed(5)}
        {grid ? ` · OS grid ${grid}` : ""}
      </span>
    </span>
  );
}
