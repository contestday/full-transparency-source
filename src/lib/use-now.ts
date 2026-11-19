"use client";

import { useEffect, useState } from "react";

/** The current time, refreshed every `everyMs`. 0 until mounted (so server and first client render match). */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [everyMs]);
  return now;
}
