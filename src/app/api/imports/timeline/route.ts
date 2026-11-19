import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { insertObservations } from "@/lib/ingest";
import { isValidLatLng } from "@/lib/geo";
import { makeSourceRecordId } from "@/lib/timeline/parse";
import { auditStaff } from "@/lib/audit";
import { notifyAdmins } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google Timeline import, in three steps. The browser parses the export (files
 * can be hundreds of MB, far above the serverless request limit), shows a
 * preview, then streams normalised observations here in chunks. Every chunk is
 * re-validated server-side and the record ID is recomputed, so the client
 * cannot inject arbitrary data or IDs.
 */
const FORMATS = ["records", "semantic", "android_device", "ios_device"] as const;

const startSchema = z.object({
  action: z.literal("start"),
  file_name: z.string().max(255),
  file_hash: z.string().regex(/^[a-f0-9]{64}$/),
  file_size: z.number().int().nonnegative(),
  format: z.enum(FORMATS),
  total_records: z.number().int().nonnegative(),
  rejected_in_file: z.number().int().nonnegative(),
  duplicates_in_file: z.number().int().nonnegative(),
  force: z.boolean().optional(),
});

const chunkSchema = z.object({
  action: z.literal("chunk"),
  batch_id: z.uuid(),
  observations: z
    .array(
      z.object({
        observedAt: z.iso.datetime(),
        lat: z.number(),
        lng: z.number(),
        accuracyM: z.number().nullable(),
        metadata: z
          .object({
            kind: z.enum(["raw", "visit_start", "visit_end", "path"]),
            placeName: z.string().max(300).optional(),
            placeId: z.string().max(300).optional(),
            format: z.enum(FORMATS),
          })
          .strict(),
      }),
    )
    .max(5000),
});

const finishSchema = z.object({
  action: z.literal("finish"),
  batch_id: z.uuid(),
  status: z.enum(["completed", "failed", "cancelled"]),
  error: z.string().max(1000).optional(),
});

const bodySchema = z.discriminatedUnion("action", [startSchema, chunkSchema, finishSchema]);

export const POST = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const body = await parseJson(request, bodySchema);

  if (body.action === "start") {
    const { data: existing } = await supabase
      .from("location_import_batches")
      .select("id, created_at, imported_count")
      .eq("file_hash", body.file_hash)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle();
    if (existing && !body.force) {
      return json(
        {
          error: "This exact file has already been imported.",
          previous_batch: existing,
          hint: "Re-importing is safe (duplicates are skipped) — resend with force: true to continue.",
        },
        { status: 409 },
      );
    }
    const { data, error } = await supabase
      .from("location_import_batches")
      .insert({
        source: "google_timeline",
        file_name: body.file_name,
        file_hash: body.file_hash,
        detected_format: body.format,
        status: "running",
        rejected_count: body.rejected_in_file,
        created_by: user.id,
        metadata: {
          file_size: body.file_size,
          total_records: body.total_records,
          duplicates_in_file: body.duplicates_in_file,
        },
      })
      .select("id")
      .single();
    if (error) throw error;
    await auditStaff(supabase, user.id, {
      action: "import.started",
      resourceType: "location_import_batch",
      resourceId: data.id,
      metadata: { file_name: body.file_name, file_hash: body.file_hash, format: body.format },
    });
    return json({ batch_id: data.id });
  }

  const { data: batch, error: batchErr } = await supabase
    .from("location_import_batches")
    .select("id, status, imported_count, duplicate_count, rejected_count, file_name")
    .eq("id", body.batch_id)
    .maybeSingle();
  if (batchErr) throw batchErr;
  if (!batch) throw new HttpError(404, "Import batch not found");
  if (batch.status !== "running") throw new HttpError(409, `Batch is ${batch.status}`);

  if (body.action === "chunk") {
    let rejected = 0;
    const rows = body.observations.flatMap((o) => {
      const t = Date.parse(o.observedAt);
      if (!isValidLatLng(o.lat, o.lng) || Number.isNaN(t) || t > Date.now() + 86_400_000) {
        rejected++;
        return [];
      }
      return [
        {
          sourceRecordId: makeSourceRecordId(t, o.lat, o.lng),
          observedAt: new Date(t).toISOString(),
          lat: o.lat,
          lng: o.lng,
          accuracyM: o.accuracyM !== null && o.accuracyM >= 0 && o.accuracyM <= 100_000 ? o.accuracyM : null,
          metadata: o.metadata,
        },
      ];
    });
    const { inserted, duplicates } = await insertObservations(supabase, "google_timeline", batch.id, rows);
    const { error } = await supabase
      .from("location_import_batches")
      .update({
        imported_count: batch.imported_count + inserted.length,
        duplicate_count: batch.duplicate_count + duplicates,
        rejected_count: batch.rejected_count + rejected,
      })
      .eq("id", batch.id);
    if (error) throw error;
    return json({ inserted: inserted.length, duplicates, rejected });
  }

  // finish
  const { data: finished, error } = await supabase
    .from("location_import_batches")
    .update({ status: body.status, error: body.error ?? null, completed_at: new Date().toISOString() })
    .eq("id", batch.id)
    .select("id, status, imported_count, duplicate_count, rejected_count")
    .single();
  if (error) throw error;
  await auditStaff(supabase, user.id, {
    action: `import.${body.status}`,
    resourceType: "location_import_batch",
    resourceId: batch.id,
    metadata: finished,
  });
  if (body.status === "failed") {
    await notifyAdmins({
      event: "import_failure",
      title: "Timeline import failed",
      body: `Import of ${batch.file_name ?? "file"} failed.`,
      url: "/admin/imports",
    });
  }
  return json({ summary: finished });
});

export const GET = handle(async () => {
  const { supabase } = await requireRole(["admin"]);
  const { data, error } = await supabase
    .from("location_import_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return json({ batches: data });
});
