import { z } from "zod";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { enforceRateLimits } from "@/lib/rate-limit";
import { assertSenderAllowed, requestCountry } from "@/lib/submission-guard";
import { looksAutomated } from "@/lib/geofence/submission";
import { notifyAdmins } from "@/lib/notify";
import { auditSystem } from "@/lib/audit";
import { WISH_LABELS } from "@/lib/plan-wishes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  kind: z.enum(["permission", "objection"]),
  reason: z.string().trim().max(1000).optional(),
  form_started_at: z.number().int(),
  website: z.string().max(200).default(""),
});

/**
 * Anyone can give permission for a plan, or object to it, with an optional
 * reason. A wish, not an order. Only the owner sees them: nothing about them
 * is public.
 */
export const POST = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Plan not found");
  const input = await parseJson(request, body);
  if (looksAutomated(input.form_started_at, input.website)) return json({ ok: true }, { status: 201 });

  const supabase = createServiceClient();
  const { data: plan, error: planErr } = await supabase.from("public_plans").select("id, title").eq("id", id).maybeSingle();
  if (planErr) throw planErr;
  if (!plan) throw new HttpError(404, "Plan not found");

  const submitterHash = await enforceRateLimits(request, [
    { name: "wish:hour", windowSeconds: 3600, max: 10 },
    { name: "wish:day", windowSeconds: 86400, max: 40 },
  ]);
  const country = requestCountry(request);
  await assertSenderAllowed(submitterHash, country);

  const { data: row, error } = await supabase
    .from("plan_wishes")
    .insert({ plan_id: id, kind: input.kind, reason: input.reason || null, submitter_hash: submitterHash, submitter_country: country })
    .select("id")
    .single();
  if (error) throw error;

  await auditSystem("anonymous", { action: `plan.${input.kind}`, resourceType: "plan_wish", resourceId: row.id });
  await notifyAdmins({
    event: "plan_wish",
    title: `${WISH_LABELS[input.kind]} for a plan`,
    body: `"${plan.title}"${input.reason ? " (with a reason)" : ""}.`,
    url: "/admin/plans#wishes",
  });
  return json({ ok: true }, { status: 201 });
});
