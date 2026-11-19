import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";

/**
 * The public sample watch view: one real watch link, set up by the owner,
 * shown to anyone at /sample so they can see what a watcher sees. Once it is
 * locked, nothing on it can be added, changed or removed. Its link is kept
 * here (it is public by design); real watchers' links are never stored.
 */
export interface SampleWatcher {
  watcherId: string;
  token: string;
  locked: boolean;
}

const KEY = "sample_watcher";

export async function loadSampleWatcher(): Promise<SampleWatcher | null> {
  const { data } = await createServiceClient().from("system_state").select("value").eq("key", KEY).maybeSingle();
  const v = data?.value as Partial<SampleWatcher> | null;
  return v?.watcherId && v.token ? { watcherId: v.watcherId, token: v.token, locked: Boolean(v.locked) } : null;
}

export async function saveSampleWatcher(v: SampleWatcher | null) {
  const supabase = createServiceClient();
  if (!v) await supabase.from("system_state").delete().eq("key", KEY);
  else await supabase.from("system_state").upsert({ key: KEY, value: v, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export const SAMPLE_LOCKED_MESSAGE = "This is a sample account. It can't be changed. Please return to the main app.";

/** Refuse any change to the sample watch link once it's locked. */
export async function assertNotLockedSample(watcherId: string) {
  const s = await loadSampleWatcher();
  if (s?.locked && s.watcherId === watcherId) throw new HttpError(403, SAMPLE_LOCKED_MESSAGE);
}
