import { handle, HttpError, json } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { enforceRateLimits } from "@/lib/rate-limit";
import { assertSenderAllowed, requestCountry } from "@/lib/submission-guard";
import { ATTACHMENT_LIMITS, incidentTimestamp, reportSchema, sniffMime } from "@/lib/reports";
import { makeReference } from "@/lib/crypto";
import { looksAutomated } from "@/lib/geofence/submission";
import { notifyAdmins } from "@/lib/notify";
import { auditSystem } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Confidential report. multipart/form-data so an evidence file can be attached. */
export const POST = handle(async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) throw new HttpError(415, "Expected multipart/form-data");
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
  const input = reportSchema.parse(fields);

  if (looksAutomated(input.form_started_at, input.website)) {
    return json({ reference: makeReference("R") }, { status: 201 });
  }

  const file = form.get("attachment");
  let attachment: { bytes: Uint8Array; mime: string; ext: string } | null = null;
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > ATTACHMENT_LIMITS.maxBytes) throw new HttpError(413, "Attachment exceeds 10 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime) throw new HttpError(415, "Attachment must be a JPEG, PNG, WebP image or PDF");
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[mime];
    attachment = { bytes, mime, ext };
  }

  const submitterHash = await enforceRateLimits(request, [
    { name: "report:hour", windowSeconds: 3600, max: 5 },
    { name: "report:day", windowSeconds: 86400, max: 20 },
  ]);
  const country = requestCountry(request);
  await assertSenderAllowed(submitterHash, country);

  const supabase = createServiceClient();
  const reference = makeReference("R");
  const { data: report, error } = await supabase
    .from("incident_reports")
    .insert({
      reference,
      category: input.category,
      description: input.description,
      incident_at: incidentTimestamp(input.incident_date, input.incident_time),
      incident_time_approximate: !input.incident_time,
      general_location: input.general_location,
      contact_info: input.contact_info,
      related_geofence_reference: input.related_geofence_reference,
      submitter_hash: submitterHash,
      submitter_country: country,
    })
    .select("id")
    .single();
  if (error) throw error;

  if (attachment) {
    // Random object name; the original filename (which may identify the sender) is discarded.
    const path = `${report.id}/${crypto.randomUUID()}.${attachment.ext}`;
    const { error: upErr } = await supabase.storage
      .from("report-attachments")
      .upload(path, attachment.bytes, { contentType: attachment.mime, upsert: false });
    if (upErr) {
      console.error("attachment upload failed", upErr);
    } else {
      await supabase.from("report_attachments").insert({
        report_id: report.id,
        storage_path: path,
        mime_type: attachment.mime,
        size_bytes: attachment.bytes.length,
      });
    }
  }

  await auditSystem("anonymous", { action: "report.submitted", resourceType: "incident_report", resourceId: report.id });
  await notifyAdmins({
    event: "report_submitted",
    title: "New confidential report",
    body: `Reference ${reference}.`,
    url: `/admin/reports?ref=${reference}`,
  });

  return json({ reference }, { status: 201 });
});
