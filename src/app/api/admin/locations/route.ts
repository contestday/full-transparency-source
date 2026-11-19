import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  source: z.enum(["followmee", "google_timeline", "manual", "ingest_api"]).optional(),
  batch_id: z.uuid().optional(),
  category: z.string().max(50).optional(),
  format: z.enum(["json", "csv", "geojson"]).default("json"),
  limit: z.coerce.number().int().min(1).max(20000).default(5000),
});

export const GET = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const params = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const to = params.to ?? new Date().toISOString();
  const from = params.from ?? new Date(Date.parse(to) - 24 * 3600_000).toISOString();

  let q = supabase
    .from("location_observations")
    .select("id, source, source_record_id, device_id, observed_at, ingested_at, lat, lng, accuracy_m, import_batch_id, validation_status")
    .gte("observed_at", from)
    .lte("observed_at", to)
    .order("observed_at", { ascending: true })
    .limit(params.limit);
  if (params.source) q = q.eq("source", params.source);
  if (params.batch_id) q = q.eq("import_batch_id", params.batch_id);

  let vq = supabase
    .from("visits")
    .select("id, started_at, ended_at, lat, lng, radius_m, category, venue_id, confidence, planned_activity_id")
    .lte("started_at", to)
    .gte("ended_at", from)
    .order("started_at", { ascending: true });
  if (params.category) vq = vq.eq("category", params.category);

  const [{ data: observations, error }, { data: visits, error: vErr }, { data: latest }] = await Promise.all([
    q,
    vq,
    supabase
      .from("location_observations")
      .select("observed_at, lat, lng, accuracy_m, source")
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) throw error;
  if (vErr) throw vErr;

  if (params.format !== "json") {
    await auditStaff(supabase, user.id, {
      action: "locations.exported",
      resourceType: "location_observations",
      metadata: { from, to, format: params.format, count: observations?.length ?? 0 },
    });
  }

  if (params.format === "csv") {
    const header = "observed_at,lat,lng,accuracy_m,source,source_record_id,import_batch_id,ingested_at\n";
    const csv =
      header +
      (observations ?? [])
        .map((o) =>
          [o.observed_at, o.lat, o.lng, o.accuracy_m ?? "", o.source, `"${String(o.source_record_id).replace(/"/g, '""')}"`, o.import_batch_id ?? "", o.ingested_at].join(","),
        )
        .join("\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="locations-${from.slice(0, 10)}-${to.slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  if (params.format === "geojson") {
    const fc = {
      type: "FeatureCollection",
      features: (observations ?? []).map((o) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [o.lng, o.lat] },
        properties: { observed_at: o.observed_at, accuracy_m: o.accuracy_m, source: o.source },
      })),
    };
    return new Response(JSON.stringify(fc), {
      headers: {
        "content-type": "application/geo+json",
        "content-disposition": `attachment; filename="locations-${from.slice(0, 10)}-${to.slice(0, 10)}.geojson"`,
        "cache-control": "no-store",
      },
    });
  }
  return json(
    { from, to, observations, visits, latest, truncated: (observations?.length ?? 0) >= params.limit },
    { headers: { "cache-control": "no-store" } },
  );
});
