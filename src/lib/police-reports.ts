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
