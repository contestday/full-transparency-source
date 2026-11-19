import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { REPORT_STATUSES } from "@/lib/reports";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function checkId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Not found");
}

/** Report detail: notes, attachments (signed URLs), audit trail. */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  checkId(id);
  const { supabase, role } = await requireRole(["admin", "reviewer"]);
  const { data: report, error } = await supabase.from("incident_reports").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!report) throw new HttpError(404, "Not found");
  const [{ data: notes }, { data: attachments }, audit] = await Promise.all([
    supabase.from("report_notes").select("id, body, author_id, created_at").eq("report_id", id).order("created_at"),
    supabase.from("report_attachments").select("id, storage_path, mime_type, size_bytes, created_at").eq("report_id", id),
    role === "admin"
      ? supabase
          .from("audit_events")
          .select("id, action, actor_id, actor_label, metadata, created_at")
          .eq("resource_type", "incident_report")
          .eq("resource_id", id)
          .order("created_at")
      : Promise.resolve({ data: [] }),
  ]);
  const signed = await Promise.all(
    (attachments ?? []).map(async (a) => {
      const { data } = await supabase.storage.from("report-attachments").createSignedUrl(a.storage_path, 300);
      return { ...a, url: data?.signedUrl ?? null };
    }),
  );
  const { submitter_hash: _omit, ...safeReport } = report;
  void _omit;
  return json({ report: safeReport, notes, attachments: signed, audit: audit.data ?? [] });
});

const patchSchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  note: z.string().trim().min(1).max(5000).optional(),
});

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  checkId(id);
  const { supabase, user } = await requireRole(["admin", "reviewer"]);
  const input = await parseJson(request, patchSchema);
  if (input.status) {
    const { data: before } = await supabase.from("incident_reports").select("status").eq("id", id).maybeSingle();
    if (!before) throw new HttpError(404, "Not found");
    const { error } = await supabase
      .from("incident_reports")
      .update({ status: input.status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    await auditStaff(supabase, user.id, {
      action: "report.status_changed",
      resourceType: "incident_report",
      resourceId: id,
      metadata: { from: before.status, to: input.status },
    });
  }
  if (input.note) {
    const { error } = await supabase.from("report_notes").insert({ report_id: id, author_id: user.id, body: input.note });
    if (error) throw error;
    await auditStaff(supabase, user.id, { action: "report.note_added", resourceType: "incident_report", resourceId: id });
  }
  return json({ ok: true });
});
