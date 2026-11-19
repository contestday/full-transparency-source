import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    ids: z.array(z.uuid()).max(1000).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    reason: z.string().trim().max(500).optional(),
    restore: z.boolean().optional(),
  })
  .refine((v) => v.ids?.length || (v.from && v.to), { message: "Provide ids or a from/to range" });

/** Withdraw (or restore) published history records. Records are never hard-deleted. */
export const POST = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const input = await parseJson(request, schema);
  const update = input.restore
    ? { visibility_status: "published", withdrawn_at: null, withdrawn_reason: null }
    : { visibility_status: "withdrawn", withdrawn_at: new Date().toISOString(), withdrawn_reason: input.reason ?? null };
  let q = supabase.from("published_locations").update(update);
  if (input.ids?.length) q = q.in("id", input.ids);
  else if (input.from && input.to) q = q.gte("observed_at", input.from).lte("observed_at", input.to);
  else throw new HttpError(422, "Nothing selected");
  const { data, error } = await q.select("id");
  if (error) throw error;
  await auditStaff(supabase, user.id, {
    action: input.restore ? "publication.restored" : "publication.withdrawn",
    resourceType: "published_locations",
    metadata: { count: data?.length ?? 0, from: input.from, to: input.to, reason: input.reason },
  });
  revalidatePath("/history");
  return json({ updated: data?.length ?? 0 });
});

export const GET = handle(async (request: Request) => {
  const { supabase } = await requireRole(["admin"]);
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = url.searchParams.get("to") ?? new Date().toISOString();
  const { data, error } = await supabase
    .from("published_locations")
    .select("*")
    .gte("observed_at", from)
    .lte("observed_at", to)
    .order("observed_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return json({ records: data });
});
