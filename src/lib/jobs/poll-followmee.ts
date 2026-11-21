import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { FOLLOWMEE_MAX_HISTORY_HOURS, fetchFollowMeeHistory } from "@/lib/followmee";
import { evaluateGeofences, getSystemState, insertObservations, setSystemState } from "@/lib/ingest";
import { notifyAdmins } from "@/lib/notify";
import { adminSilenceAlertMs, requireServerEnv } from "@/lib/env";
import { auditSystem } from "@/lib/audit";
import { updateLiveStatus } from "@/lib/jobs/update-live-status";
import { sendStillThereReminders } from "@/lib/watchers";

export interface PollSummary {
  batchId: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  geofenceEvents: { enter: number; exit: number };
  liveStatus: string;
  latestObservedAt: string | null;
  stale: boolean;
}

export async function pollFollowMee(): Promise<PollSummary> {
  const cfg = {
    apiKey: requireServerEnv("FOLLOWMEE_API_KEY"),
    username: requireServerEnv("FOLLOWMEE_USERNAME"),
    deviceId: requireServerEnv("FOLLOWMEE_DEVICE_ID"),
  };
  const supabase = createServiceClient();

  const { data: latest } = await supabase
    .from("location_observations")
    .select("observed_at")
    .eq("source", "followmee")
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // First run backfills everything FollowMee still holds.
  const sinceMs = latest ? Date.now() - Date.parse(latest.observed_at) : FOLLOWMEE_MAX_HISTORY_HOURS * 3600_000;
  const hours = Math.ceil(sinceMs / 3600_000) + 1; // overlap is harmless: inserts are idempotent

  const { data: batch, error: batchErr } = await supabase
    .from("location_import_batches")
    .insert({ source: "followmee", status: "running", metadata: { hours_requested: hours } })
    .select("id")
    .single();
  if (batchErr) throw batchErr;

  try {
    const { observations, rejected } = await fetchFollowMeeHistory(cfg, hours);
    const { inserted, duplicates } = await insertObservations(supabase, "followmee", batch.id, observations);
    const geofenceEvents = await evaluateGeofences(inserted);
    // Events: runs even with no new rows, so an event starting or ending is noticed.
    await import("@/lib/events/server").then((m) => m.evaluateEvents(inserted)).catch((err) => console.error("event check failed", err));
    // Always runs (even with no new rows) so the marker turns grey when stale.
    const liveStatus = await updateLiveStatus(inserted);
    // "Still there" reminders for watchers' Want areas and Locations.
    await sendStillThereReminders().catch((err) => console.error("still-there reminders failed", err));

    await supabase
      .from("location_import_batches")
      .update({
        status: "completed",
        imported_count: inserted.length,
        duplicate_count: duplicates,
        rejected_count: rejected.length,
        completed_at: new Date().toISOString(),
        metadata: { hours_requested: hours, rejected: rejected.slice(0, 50) },
      })
      .eq("id", batch.id);

    const newest = observations.at(-1)?.observedAt ?? latest?.observed_at ?? null;
    // FollowMee is silent while the phone is still; this private alert only flags a very long silence.
    const staleAfterMin = Math.round(adminSilenceAlertMs() / 60_000);
    const stale = !newest || Date.now() - Date.parse(newest) > adminSilenceAlertMs();
    const staleState = await getSystemState<{ notified: boolean }>("followmee_stale");
    if (stale && !staleState?.notified) {
      await notifyAdmins({
        event: "ingestion_stale",
        title: "GPS updates are stale",
        body: `No new FollowMee position for more than ${staleAfterMin} minutes.`,
        url: "/admin",
      });
      await setSystemState("followmee_stale", { notified: true, since: newest });
    } else if (!stale && staleState?.notified) {
      await setSystemState("followmee_stale", { notified: false });
    }
    await setSystemState("followmee_last_success", { at: new Date().toISOString(), newest });

    return {
      batchId: batch.id,
      fetched: observations.length,
      inserted: inserted.length,
      duplicates,
      rejected: rejected.length,
      geofenceEvents,
      liveStatus,
      latestObservedAt: newest,
      stale,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("location_import_batches")
      .update({ status: "failed", error: message.slice(0, 1000), completed_at: new Date().toISOString() })
      .eq("id", batch.id);
    await auditSystem("cron", {
      action: "followmee.poll_failed",
      resourceType: "location_import_batch",
      resourceId: batch.id,
      metadata: { error: message.slice(0, 500) },
    });
    // Throttle failure alerts to one per hour.
    const last = await getSystemState<{ at: string }>("followmee_failure_notified");
    if (!last || Date.now() - Date.parse(last.at) > 3600_000) {
      await notifyAdmins({
        event: "ingestion_failure",
        title: "FollowMee ingestion failed",
        body: message.slice(0, 180),
        url: "/admin/imports",
      });
      await setSystemState("followmee_failure_notified", { at: new Date().toISOString() });
    }
    throw err;
  }
}
