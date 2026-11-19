import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { fmtDateTime, relativeAge } from "@/lib/format";
import { numberEnv, optionalEnv } from "@/lib/env";
import { buildPolicy, type PublicationRuleRow } from "@/lib/publication";
import { JobButtons } from "./job-buttons";

export default async function AdminDashboard() {
  const { supabase, role } = await requirePageRole(["admin", "reviewer"]);
  if (role !== "admin") redirect("/admin/reports");

  const { nowIso, weekAgoIso } = timeAnchors();
  const [latest, followmeeState, publishState, rules, newReports, activeFences, upcomingPlans, events, failedDeliveries, lastBatch] =
    await Promise.all([
      supabase.from("location_observations").select("observed_at, accuracy_m, source").order("observed_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("system_state").select("value").eq("key", "followmee_last_success").maybeSingle(),
      supabase.from("system_state").select("value").eq("key", "publish_last_run").maybeSingle(),
      supabase.from("publication_rules").select("rule_type, configuration, enabled"),
      supabase.from("incident_reports").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("geofences").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("planned_activities").select("id", { count: "exact", head: true }).eq("archived", false).gte("starts_at", nowIso),
      supabase
        .from("geofence_events")
        // Watchers' Locations are private to them: Wish and Want areas and mine only.
        .select("id, event_type, observed_at, geofence:geofences!inner(reference, tier)")
        .or("tier.is.null,tier.in.(wide,local)", { referencedTable: "geofences" })
        .order("created_at", { ascending: false })
        .limit(8),
      supabase.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", weekAgoIso),
      supabase.from("location_import_batches").select("source, status, created_at, error").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

  const policy = buildPolicy((rules.data ?? []) as PublicationRuleRow[]);
  const staleMin = numberEnv("STALE_AFTER_MINUTES", 30);
  const latestAt = latest.data?.observed_at ?? null;
  const stale = isStale(latestAt, staleMin);
  const followmeeConfigured = Boolean(optionalEnv("FOLLOWMEE_API_KEY") && optionalEnv("FOLLOWMEE_USERNAME") && optionalEnv("FOLLOWMEE_DEVICE_ID"));
  const fm = followmeeState.data?.value as { at?: string } | undefined;
  const pub = publishState.data?.value as { at?: string; published?: number; skipped?: Record<string, number> } | undefined;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" actions={<JobButtons />} />

      {!policy.exclusionZones.length && (
        <Notice tone="amber" title="Publication blocked: no hidden zone">
          Nothing will be published until you save your home (which hides the area around it) in{" "}
          <Link className="underline" href="/admin/settings">Settings</Link>.
        </Notice>
      )}
      {!followmeeConfigured && (
        <Notice tone="amber">FollowMee is not configured. Set FOLLOWMEE_API_KEY, FOLLOWMEE_USERNAME and FOLLOWMEE_DEVICE_ID.</Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs uppercase text-muted">Latest GPS</p>
          <p className="mt-1 text-lg font-semibold">{relativeAge(latestAt)}</p>
          <p className="text-xs text-muted">{fmtDateTime(latestAt)}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {stale ? <Badge tone="red">Stale (&gt;{staleMin} min)</Badge> : <Badge tone="green">Current</Badge>}
            {latest.data?.accuracy_m != null && <Badge>±{Math.round(latest.data.accuracy_m)} m</Badge>}
            {latest.data?.source && <Badge tone="blue">{latest.data.source}</Badge>}
          </div>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted">FollowMee polling</p>
          <p className="mt-1 text-lg font-semibold">{fm?.at ? relativeAge(fm.at) : "No successful poll"}</p>
          {lastBatch.data?.status === "failed" && (
            <p className="mt-1 text-xs text-red-700">Last batch failed: {lastBatch.data.error?.slice(0, 120)}</p>
          )}
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted">Publication</p>
          <p className="mt-1 text-lg font-semibold">{policy.paused ? "Paused" : "Active"}</p>
          <p className="text-xs text-muted">
            Delay {policy.delayHours} h · grid {policy.gridM} m · {policy.exclusionZones.length} exclusion zone(s)
          </p>
          {pub?.at && (
            <p className="text-xs text-muted">
              Last run {relativeAge(pub.at)}: {pub.published ?? 0} published
            </p>
          )}
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted">Inbox</p>
          <ul className="mt-1 space-y-1 text-sm">
            <li>
              <Link className="text-accent underline" href="/admin/reports?status=new">{newReports.count ?? 0} new report(s)</Link>
            </li>
            <li>
              <Link className="text-accent underline" href="/admin/geofences">{activeFences.count ?? 0} active area(s)</Link>
            </li>
            <li>
              <Link className="text-accent underline" href="/admin/plans">{upcomingPlans.count ?? 0} upcoming plan(s)</Link>
            </li>
            {(failedDeliveries.count ?? 0) > 0 && (
              <li className="text-red-700">{failedDeliveries.count} failed notification(s) in 7 days</li>
            )}
          </ul>
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 font-semibold">Recent geofence events</h2>
        {!events.data?.length ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {events.data.map((e) => {
              const ref = (e.geofence as unknown as { reference: string } | null)?.reference;
              return (
                <li key={e.id} className="flex justify-between py-1.5">
                  <span>
                    <Badge tone={e.event_type === "enter" ? "red" : e.event_type === "exit" ? "green" : "neutral"}>{e.event_type}</Badge>{" "}
                    {ref}
                  </span>
                  <span className="text-muted">{fmtDateTime(e.observed_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function timeAnchors() {
  const now = Date.now();
  return { nowIso: new Date(now).toISOString(), weekAgoIso: new Date(now - 7 * 86_400_000).toISOString() };
}

function isStale(latestAt: string | null, staleMin: number) {
  return !latestAt || Date.now() - Date.parse(latestAt) > staleMin * 60_000;
}
