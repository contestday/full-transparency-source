import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * The ONLY module public pages/endpoints use for data. It reads exclusively from
 * the public_* views, which contain already-generalised, published records.
 * (A unit test asserts no private table names appear in this file.)
 */

export interface PublicHistoryRecord {
  id: string;
  kind: "visit" | "track";
  public_lat: number;
  public_lng: number;
  cell_size_m: number;
  area_label: string | null;
  category: string | null;
  /** Set for public venues (pubs, hotels, ...): exact position, cell_size_m = 0. */
  venue_name: string | null;
  observed_at: string;
  observed_until: string | null;
  published_at: string;
}

export interface PublicPlan {
  id: string;
  title: string;
  category: string;
  venue_name: string | null;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  status: string;
  publication_mode: string;
  public_area_label: string | null;
  public_lat: number | null;
  public_lng: number | null;
  public_cell_size_m: number | null;
  published_at: string;
  updated_at: string;
  /** How a completed plan was confirmed: GPS record or my word (migration 0010). */
  completion_source?: "gps" | "owner" | null;
  actual_started_at?: string | null;
  actual_ended_at?: string | null;
  /** Further locations, already filtered by the venue privacy rule. */
  extra_locations: PublicPlanLocation[];
}

export interface PublicPlanLocation {
  position: number;
  venue_name: string | null;
  area_label: string | null;
  public_lat: number | null;
  public_lng: number | null;
  public_cell_size_m: number | null;
}

/** Upper bound on rows per history request (~3 weeks of 3-minute samples). */
export const HISTORY_MAX_ROWS = 12_000;

export async function getPublicHistory(from: string, to: string): Promise<{
  records: PublicHistoryRecord[];
  lastPublishedAt: string | null;
  paused: boolean;
}> {
  if (!isSupabaseConfigured()) return { records: [], lastPublishedAt: null, paused: true };
  const supabase = createServiceClient();
  // Supabase returns at most 1,000 rows per request: page through the range
  // (3-minute route samples make ~480 rows a day).
  const fetchAll = async () => {
    const rows: PublicHistoryRecord[] = [];
    for (let fromRow = 0; fromRow < HISTORY_MAX_ROWS; fromRow += 1000) {
      const { data, error } = await supabase
        .from("public_history")
        .select("*")
        .gte("observed_at", from)
        .lte("observed_at", to)
        .order("observed_at", { ascending: true })
        .order("id", { ascending: true })
        .range(fromRow, fromRow + 999);
      if (error) return { data: rows, error };
      rows.push(...((data ?? []) as PublicHistoryRecord[]));
      if (!data || data.length < 1000) break;
    }
    return { data: rows, error: null };
  };
  const [{ data, error }, { data: status }] = await Promise.all([
    fetchAll(),
    supabase.from("public_status").select("publication_paused, last_published_at").maybeSingle(),
  ]);
  if (error) throw error;
  return {
    records: (data ?? []) as PublicHistoryRecord[],
    lastPublishedAt: status?.last_published_at ?? null,
    paused: status?.publication_paused ?? true,
  };
}

export async function getPublicPlans(opts: { from?: string; to?: string; category?: string; status?: string } = {}): Promise<PublicPlan[]> {
  if (!isSupabaseConfigured()) return [];
  let q = createServiceClient().from("public_plans").select("*").order("starts_at", { ascending: true }).limit(500);
  if (opts.from) q = q.gte("starts_at", opts.from);
  if (opts.to) q = q.lte("starts_at", opts.to);
  if (opts.category) q = q.eq("category", opts.category);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw error;
  const plans = (data ?? []) as Omit<PublicPlan, "extra_locations">[];
  if (!plans.length) return [];
  const { data: locs, error: locErr } = await createServiceClient()
    .from("public_plan_locations")
    .select("*")
    .in("plan_id", plans.map((p) => p.id))
    .order("position");
  // Extra locations are optional: never fail the whole board because of them.
  if (locErr) console.error("public_plan_locations unavailable", locErr.message);
  const byPlan = new Map<string, PublicPlanLocation[]>();
  for (const l of (locs ?? []) as (PublicPlanLocation & { plan_id: string })[]) {
    const { plan_id, ...rest } = l;
    byPlan.set(plan_id, [...(byPlan.get(plan_id) ?? []), rest]);
  }
  return plans.map((p) => ({ ...p, extra_locations: byPlan.get(p.id) ?? [] }));
}

export interface PublicLiveStatus {
  status: "green" | "yellow" | "amber" | "red" | "purple" | "unknown" | "disabled";
  public_lat: number | null;
  public_lng: number | null;
  cell_size_m: number | null;
  observed_at: string | null;
  status_since: string | null;
  updated_at: string | null;
  /** True when recent GPS shows movement (absent before migration 0008). */
  moving?: boolean;
}

export async function getPublicLiveStatus(): Promise<PublicLiveStatus> {
  const off: PublicLiveStatus = { status: "disabled", public_lat: null, public_lng: null, cell_size_m: null, observed_at: null, status_since: null, updated_at: null };
  if (!isSupabaseConfigured()) return off;
  const { data, error } = await createServiceClient().from("public_live_status").select("*").maybeSingle();
  if (error) throw error;
  return (data as PublicLiveStatus | null) ?? off;
}
