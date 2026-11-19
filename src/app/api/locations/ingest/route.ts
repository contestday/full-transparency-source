import { z } from "zod";
import { handle, json, parseJson, requireBearer } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { evaluateGeofences, insertObservations } from "@/lib/ingest";
import { isValidLatLng } from "@/lib/geo";
import { optionalEnv } from "@/lib/env";
import { updateLiveStatus } from "@/lib/jobs/update-live-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Push-style secure GPS ingestion for a dedicated worker or device bridge.
 * Auth: Authorization: Bearer <GPS_INGEST_SECRET>
 */
const bodySchema = z.object({
  device_id: z.string().max(100).optional(),
  observations: z
    .array(
      z.object({
        source_record_id: z.string().min(1).max(200).optional(),
        observed_at: z.iso.datetime({ offset: true }),
        lat: z.number(),
        lng: z.number(),
        accuracy_m: z.number().min(0).max(100_000).nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(5000),
});

export const POST = handle(async (request: Request) => {
  requireBearer(request, optionalEnv("GPS_INGEST_SECRET"));
  const body = await parseJson(request, bodySchema);
  const now = Date.now();
  const rejected: { index: number; reason: string }[] = [];
  const rows = body.observations.flatMap((o, index) => {
    const t = Date.parse(o.observed_at);
    if (!isValidLatLng(o.lat, o.lng)) {
      rejected.push({ index, reason: "invalid coordinates" });
      return [];
    }
    if (t > now + 10 * 60_000) {
      rejected.push({ index, reason: "timestamp in the future" });
      return [];
    }
    const iso = new Date(t).toISOString();
    return [
      {
        sourceRecordId: o.source_record_id ?? `${body.device_id ?? "api"}:${iso}`,
        observedAt: iso,
        lat: o.lat,
        lng: o.lng,
        accuracyM: o.accuracy_m ?? null,
        deviceId: body.device_id ?? null,
        metadata: o.metadata ?? {},
      },
    ];
  });

  const supabase = createServiceClient();
  const { data: batch, error } = await supabase
    .from("location_import_batches")
    .insert({ source: "ingest_api", status: "running" })
    .select("id")
    .single();
  if (error) throw error;

  const { inserted, duplicates } = await insertObservations(supabase, "ingest_api", batch.id, rows);
  const geofenceEvents = await evaluateGeofences(inserted);
  const liveStatus = await updateLiveStatus(inserted);
  await supabase
    .from("location_import_batches")
    .update({
      status: "completed",
      imported_count: inserted.length,
      duplicate_count: duplicates,
      rejected_count: rejected.length,
      completed_at: new Date().toISOString(),
      metadata: { rejected: rejected.slice(0, 50) },
    })
    .eq("id", batch.id);

  return json({ batch_id: batch.id, inserted: inserted.length, duplicates, rejected, geofence_events: geofenceEvents, live_status: liveStatus });
});
