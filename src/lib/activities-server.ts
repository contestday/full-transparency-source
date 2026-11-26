import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { ActivityOption, ActivityView } from "@/lib/activities";

const COLS = "reference, label, details, level, is_owner, status, created_at, ended_at";

/** The list to choose from (system_state "activity_options"), set by me. */
export async function loadActivityOptions(): Promise<ActivityOption[]> {
  const { data } = await createServiceClient().from("system_state").select("value").eq("key", "activity_options").maybeSingle();
  const v = data?.value as { options?: unknown } | null;
  const list = Array.isArray(v?.options) ? v.options : [];
  return list.filter(
    (o): o is ActivityOption => !!o && typeof (o as ActivityOption).key === "string" && typeof (o as ActivityOption).label === "string",
  );
}

/** Activities I'm banned from that are in force (public). */
export async function loadOwnerActivities(): Promise<ActivityView[]> {
  const { data, error } = await createServiceClient()
    .from("banned_activities")
    .select(COLS)
    .eq("is_owner", true)
    .eq("status", "active")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ActivityView[];
}

/** One watch link's activities, newest first (only for that link and me). */
export async function loadWatcherActivities(watcherId: string): Promise<ActivityView[]> {
  const { data, error } = await createServiceClient()
    .from("banned_activities")
    .select(COLS)
    .eq("watcher_id", watcherId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ActivityView[];
}

/** Everything, for my admin page: mine and every watcher's. */
export async function loadAllActivities(): Promise<(ActivityView & { watcher_id: string | null })[]> {
  const { data, error } = await createServiceClient()
    .from("banned_activities")
    .select(`${COLS}, watcher_id`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as (ActivityView & { watcher_id: string | null })[];
}
