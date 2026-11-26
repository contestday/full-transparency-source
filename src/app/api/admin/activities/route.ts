import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { makeReference } from "@/lib/crypto";
import { auditStaff } from "@/lib/audit";
import { activityInputSchema, resolveActivity } from "@/lib/activities";
import { loadActivityOptions } from "@/lib/activities-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One of my own bans: an activity I mustn't do. Public, in red, like my banned events. */
export const POST = handle(async (request: Request) => {
  const { user, supabase } = await requireRole(["admin"]);
  const input = await parseJson(request, activityInputSchema);
  const resolved = resolveActivity(input, await loadActivityOptions());
  if ("error" in resolved) throw new HttpError(422, resolved.error);
  const reference = makeReference("A");
  const { data, error } = await createServiceClient()
    .from("banned_activities")
    .insert({
      reference,
      is_owner: true,
      option_key: resolved.key,
      label: resolved.label,
      details: input.details || null,
      submitter_hash: "owner",
    })
    .select("id")
    .single();
  if (error) throw error;
  await auditStaff(supabase, user.id, { action: "banned_activity.owner_set", resourceType: "banned_activity", resourceId: data.id });
  return json({ reference }, { status: 201 });
});
