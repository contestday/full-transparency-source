// Name a stay after the plan I published for that place and time. Pure.

import { haversineMeters, type LatLng } from "@/lib/geo";
import { planEndMs } from "@/lib/plan-outcome";

/** Within this distance of a planned place during the plan, I'm where I said I'd be. */
export const PLAN_MATCH_RADIUS_M = 800;
/** Slack either side of the plan's times (arriving early, leaving late). */
export const PLAN_MATCH_SLACK_MS = 60 * 60_000;

export interface MatchPlan {
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  /** The place I said (private exact point; only used for the distance). */
  point: LatLng | null;
  /** The public name already shown on the plan (venue name or public label). */
  name: string | null;
}

/** The public name of the plan this stay belongs to, or null. Nearest plan wins. */
export function planNameForStay(stay: LatLng & { from: string; until: string | null }, plans: readonly MatchPlan[]): string | null {
  const s = Date.parse(stay.from);
  const e = stay.until ? Date.parse(stay.until) : s;
  let best: { name: string; d: number } | null = null;
  for (const p of plans) {
    if (!p.point || !p.name) continue;
    const ps = Date.parse(p.starts_at) - PLAN_MATCH_SLACK_MS;
    const pe = planEndMs(p) + PLAN_MATCH_SLACK_MS;
    if (e < ps || s > pe) continue;
    const d = haversineMeters(stay, p.point);
    if (d <= PLAN_MATCH_RADIUS_M && (!best || d < best.d)) best = { name: p.name, d };
  }
  return best?.name ?? null;
}
