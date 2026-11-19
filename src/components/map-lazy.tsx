"use client";

import dynamic from "next/dynamic";

/** MapLibre needs the browser; load it client-side only. */
export const LazyMap = dynamic(() => import("./map-view").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="h-96 w-full animate-pulse rounded-lg border border-border bg-slate-100" />,
});

export type { MapFeature } from "./map-view";
