import { z } from "zod";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { enforceRateLimits } from "@/lib/rate-limit";
import { looksAutomated } from "@/lib/geofence/submission";
import { notifyAdmins } from "@/lib/notify";
import { auditSystem } from "@/lib/audit";
import { PLAN_REPORT_RULES } from "@/lib/plan-police";
import { policeReportsEnabled } from "@/lib/police-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  concern: z.string().trim().min(PLAN_REPORT_RULES.concernMin).max(PLAN_REPORT_RULES.concernMax),
  named: z.boolean().default(false),
  form_started_at: z.number().int(),
  website: z.string().max(200).default(""),
});

/**
 * Someone has prepared a police report about one of my plans. They send it
 * to the police themselves; this only tells me, so nothing happens behind
 * my back. Their concern is passed on to me; their name and contact are not
 * (only whether they gave them).
 */
export const POST = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!(await policeReportsEnabled())) throw new HttpError(404, "Not found");
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Plan not found");
  const input = await parseJson(request, body);
  if (looksAutomated(input.form_started_at, input.website)) return json({ ok: true }, { status: 201 });

  const supabase = createServiceClient();
  const { data: plan, error } = await supabase.from("public_plans").select("id, title").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!plan) throw new HttpError(404, "Plan not found");

  await enforceRateLimits(request, [
    { name: "plan-police:hour", windowSeconds: 3600, max: 5 },
    { name: "plan-police:day", windowSeconds: 86400, max: 20 },
  ]);

  await auditSystem("anonymous", { action: "plan.police_report", resourceType: "plan", resourceId: id });
  const concern = input.concern.length > 600 ? `${input.concern.slice(0, 600)}…` : input.concern;
  await notifyAdmins({
    event: "plan_police_report",
    title: "Police report prepared about a plan",
    body: `"${plan.title}" (${input.named ? "named" : "anonymous"}): ${concern}`,
    url: "/admin/plans",
  });
  return json({ ok: true }, { status: 201 });
});
