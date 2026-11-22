"use client";

import { useEffect, useState } from "react";
import { loadWatchLinks } from "@/lib/watch-links";

/**
 * The watch link saved on this device that has police reporting turned on,
 * if any (checked once per page load). Without one, Report to police
 * buttons don't show on this device.
 */
let pending: Promise<string | null> | null = null;

function findPoliceToken(): Promise<string | null> {
  if (!pending) {
    pending = (async () => {
      for (const { token } of loadWatchLinks().slice(0, 5)) {
        try {
          const r = await fetch(`/api/watch/${token}/police-reports`, { cache: "no-store" });
          if (!r.ok) continue;
          const s = (await r.json()) as { available: boolean; enabled: boolean };
          if (!s.available) return null;
          if (s.enabled) return token;
        } catch {
          /* try the next link */
        }
      }
      return null;
    })();
  }
  return pending;
}

/** undefined while checking, then the token or null. */
export function usePoliceWatchToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    findPoliceToken().then((t) => live && setToken(t));
    return () => {
      live = false;
    };
  }, []);
  return token;
}
