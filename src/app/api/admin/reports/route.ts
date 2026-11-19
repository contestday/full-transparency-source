import { requireRole } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { REPORT_STATUSES } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const { supabase } = await requireRole(["admin", "reviewer"]);
  const status = new URL(request.url).searchParams.get("status");
  let q = supabase
    .from("incident_reports")
    .select("id, reference, category, description, incident_at, incident_time_approximate, general_location, contact_info, related_geofence_reference, status, created_at, updated_at, report_attachments(id, mime_type, size_bytes)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && (REPORT_STATUSES as readonly string[]).includes(status)) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return json({ reports: data });
});
