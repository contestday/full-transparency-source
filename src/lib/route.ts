// Builds movement lines from published history records. Pure.

export interface RoutePoint {
  observed_at: string;
  observed_until?: string | null;
  public_lat: number;
  public_lng: number;
}

/**
 * Join points in time order into line segments. A new segment starts whenever
 * the gap between one point's end and the next point's start exceeds maxGapMs,
 * so the line never bridges hidden periods (e.g. time at home) or missing data.
 */
export function routeSegments(points: RoutePoint[], maxGapMs = 20 * 60_000): [number, number][][] {
  const sorted = [...points].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  let lastEnd = -Infinity;
  for (const p of sorted) {
    const start = Date.parse(p.observed_at);
    if (current.length && start - lastEnd > maxGapMs) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    const coord: [number, number] = [p.public_lng, p.public_lat];
    const prev = current.at(-1);
    if (!prev || prev[0] !== coord[0] || prev[1] !== coord[1]) current.push(coord);
    lastEnd = Math.max(start, p.observed_until ? Date.parse(p.observed_until) : start);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

/**
 * Like routeSegments, but each line is split where its colour changes
 * (e.g. green inside the okay zone, yellow outside). Pure.
 */
export function colouredRouteSegments<Z extends string>(
  points: RoutePoint[],
  /** The colour at a point; `at` is the point's time (ms), so areas set later don't count. */
  zoneOf: (p: { lat: number; lng: number }, at: number) => Z,
  maxGapMs = 20 * 60_000,
): { zone: Z; coords: [number, number][] }[] {
  type Run = { zone: Z; coords: [number, number][] };
  const out: Run[] = [];
  const sorted = [...points].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  let runs: Run[] = [];
  let lastEnd = -Infinity;
  const close = () => {
    out.push(...runs.filter((r) => r.coords.length > 1));
    runs = [];
  };
  for (const p of sorted) {
    const start = Date.parse(p.observed_at);
    // Same gap rule as routeSegments: never bridge hidden periods.
    if (runs.length && start - lastEnd > maxGapMs) close();
    const c: [number, number] = [p.public_lng, p.public_lat];
    const last = runs.at(-1);
    const prev = last?.coords[last.coords.length - 1];
    lastEnd = Math.max(start, p.observed_until ? Date.parse(p.observed_until) : start);
    if (prev && prev[0] === c[0] && prev[1] === c[1]) continue;
    const z = zoneOf({ lat: c[1], lng: c[0] }, start);
    if (last && last.zone === z) last.coords.push(c);
    // The new colour starts where the old one ended, so the line is unbroken.
    else runs.push({ zone: z, coords: prev ? [prev, c] : [c] });
  }
  close();
  return out;
}
