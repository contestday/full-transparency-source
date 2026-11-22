import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Police reporting on or off (owner's switch at the top of admin Settings).
 * Off unless the owner has switched it on: when off, the Report to police
 * pages, buttons and APIs (watch pages and plans) are gone for everyone.
 */
const KEY = "police_reports";

export async function policeReportsEnabled(): Promise<boolean> {
  try {
    const { data } = await createServiceClient().from("system_state").select("value").eq("key", KEY).maybeSingle();
    return (data?.value as { enabled?: boolean } | null)?.enabled === true;
  } catch {
    return false;
  }
}

export async function setPoliceReportsEnabled(enabled: boolean): Promise<void> {
  const { error } = await createServiceClient()
    .from("system_state")
    .upsert({ key: KEY, value: { enabled }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}

/** Has this watcher turned police reporting on for their own watch link? */
export async function watcherPoliceReports(watcherId: string): Promise<boolean> {
  const { data } = await createServiceClient().from("watchers").select("police_reports").eq("id", watcherId).maybeSingle();
  return (data as { police_reports?: boolean } | null)?.police_reports === true;
}

/** Police reporting for one watch link: available (my switch) and on for this watcher (theirs). Both must be true. */
export async function policeReportsForWatcher(watcherId: string): Promise<{ available: boolean; enabled: boolean }> {
  const available = await policeReportsEnabled();
  return { available, enabled: available && (await watcherPoliceReports(watcherId)) };
}

export async function setWatcherPoliceReports(watcherId: string, enabled: boolean): Promise<void> {
  const { error } = await createServiceClient()
    .from("watchers")
    .update({ police_reports: enabled, police_reports_at: new Date().toISOString() })
    .eq("id", watcherId);
  if (error) throw error;
}

/** How many active watch links have police reporting turned on. */
export async function countWatcherPoliceReports(): Promise<number> {
  const { count } = await createServiceClient()
    .from("watchers")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .eq("police_reports", true);
  return count ?? 0;
}
