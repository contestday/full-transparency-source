"use client";

import { useEffect, useState, type ReactNode } from "react";
import { loadWatchLinks } from "@/lib/watch-links";

/** Shows its children only on a device that has a watch link saved. */
export function WatcherOnly({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(loadWatchLinks().length > 0);
  }, []);
  return show ? <>{children}</> : null;
}
