import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { REPORT_STATUSES } from "@/lib/reports";
import { ReportsInbox, type ReportSummary } from "./reports-inbox";

export default async function AdminReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const { supabase } = await requirePageRole(["admin", "reviewer"]);
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (REPORT_STATUSES as readonly string[]).includes(sp.status) ? sp.status : "";
  let q = supabase
    .from("incident_reports")
    .select("id, reference, category, status, created_at, incident_at, general_location, related_geofence_reference")
    .order("created_at", { ascending: false })
    .limit(300);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  const ref = typeof sp.ref === "string" ? sp.ref : null;
  return (
    <div>
      <PageHeader title="Reporting inbox" description="Confidential reports. Changes are audited." />
      <ReportsInbox reports={(data ?? []) as ReportSummary[]} status={status} openRef={ref} />
    </div>
  );
}
