// Stay-point ("visit") detection from raw observations. Pure.

import { haversineMeters, type LatLng } from "@/lib/geo";

export interface ObsPoint extends LatLng {
  id?: string;
  t: number; // epoch ms
  accuracyM: number | null;
  /** Inferred "still here" point (no reading): never counted as an observation. */
  synthetic?: boolean;
}

export interface DetectedVisit {
  startedAt: number;
  endedAt: number;
  lat: number;
  lng: number;
  radiusM: number;
  count: number;
  confidence: number;
}

export interface VisitOptions {
  radiusM: number;
  minDurationMs: number;
  maxGapMs: number;
  maxAccuracyM: number;
}

export const DEFAULT_VISIT_OPTIONS: VisitOptions = {
  radiusM: 150,
  minDurationMs: 10 * 60_000,
  // No limit: with no reading in between, the phone stayed in the same place.
  maxGapMs: Number.POSITIVE_INFINITY,
  maxAccuracyM: 200,
};

export function detectVisits(points: ObsPoint[], opts: VisitOptions = DEFAULT_VISIT_OPTIONS): DetectedVisit[] {
  const pts = points
    .filter((p) => p.accuracyM === null || p.accuracyM <= opts.maxAccuracyM)
    .sort((a, b) => a.t - b.t);
  const visits: DetectedVisit[] = [];
  let i = 0;
  while (i < pts.length) {
    let sumLat = pts[i].lat;
    let sumLng = pts[i].lng;
    let n = 1;
    let j = i + 1;
    while (j < pts.length) {
      const centroid = { lat: sumLat / n, lng: sumLng / n };
      if (pts[j].t - pts[j - 1].t > opts.maxGapMs) break;
      if (haversineMeters(centroid, pts[j]) > opts.radiusM) break;
      sumLat += pts[j].lat;
      sumLng += pts[j].lng;
      n++;
      j++;
    }
    const start = pts[i].t;
    const end = pts[j - 1].t;
    if (end - start >= opts.minDurationMs) {
      const center = { lat: sumLat / n, lng: sumLng / n };
      let maxD = 0;
      for (let k = i; k < j; k++) maxD = Math.max(maxD, haversineMeters(center, pts[k]));
      const real = pts.slice(i, j).filter((p) => !p.synthetic);
      const accs = real.map((p) => p.accuracyM ?? 50);
      const meanAcc = accs.reduce((s, a) => s + a, 0) / accs.length;
      visits.push({
        startedAt: start,
        endedAt: end,
        lat: center.lat,
        lng: center.lng,
        radiusM: Math.round(maxD),
        count: real.length,
        // More points and better accuracy → higher confidence. Bounded [0.2, 0.95].
        confidence: Math.round(Math.min(0.95, Math.max(0.2, (Math.min(n, 20) / 20) * (1 - Math.min(meanAcc, 200) / 400))) * 100) / 100,
      });
      i = j;
    } else {
      i++;
    }
  }
  return visits;
}

/**
 * Where the next derive run starts. Live runs (every few minutes) must keep a
 * look-back, so a stay that is still going on, or points FollowMee delivers
 * late, are seen again; jumping to "now" would leave each run only a few
 * minutes of points and no stay would ever reach the 10-minute minimum. Only
 * while catching up on a backlog (window capped short of now) is a minimum
 * advance of an hour forced, to guarantee progress.
 */
export function nextVisitsCursor(windowStart: number, windowEnd: number, nextStart: number, now: number): number {
  const catchingUp = windowEnd < now - 60_000;
  const floor = catchingUp ? windowStart + 3600_000 : windowStart;
  return Math.min(windowEnd, Math.max(nextStart, floor));
}

/** A silence longer than this means the phone saw no movement (it checks about every minute). */
export const STATIONARY_GAP_MS = 5 * 60_000;

/**
 * FollowMee uploads only when the position changes; while you stay put it
 * sends nothing. So a silence is read as "still at the last position": add an
 * inferred point there just before the next reading (when you set off), and
 * at `now` after the latest reading, however long the silence. Late uploads
 * simply replace the guess on the next run.
 */
export function fillStationaryGaps(points: ObsPoint[], now: number, maxGapMs = DEFAULT_VISIT_OPTIONS.maxGapMs): ObsPoint[] {
  const pts = [...points].sort((a, b) => a.t - b.t);
  const out: ObsPoint[] = [];
  const hold = (p: ObsPoint, until: number) => {
    const gap = until - p.t;
    if (gap > STATIONARY_GAP_MS && gap <= maxGapMs) out.push({ lat: p.lat, lng: p.lng, t: until, accuracyM: p.accuracyM, synthetic: true });
  };
  pts.forEach((p, k) => {
    out.push(p);
    const next = pts[k + 1];
    if (next) hold(p, next.t - 60_000);
    else hold(p, now);
  });
  return out;
}
