import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, json, parseJson } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { saveSubmissionRules } from "@/lib/submission-guard";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("block"),
    submitter_hash: z.string().min(8).max(80),
    country: z.string().max(2).nullable().optional(),
    reason: z.string().trim().max(200).optional(),
  }),
  z.object({ action: z.literal("unblock"), submitter_hash: z.string().min(8).max(80) }),
  z.object({ action: z.literal("countries"), allowed_countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(50) }),
]);

/** Block or unblock a sender (by IP fingerprint), or set the allowed countries. Admin only. */
export const POST = handle(async (request: Request) => {
  const { user, supabase } = await requireRole(["admin"]);
  const input = await parseJson(request, body);
  const db = createServiceClient();
  if (input.action === "block") {
    const { error } = await db
      .from("blocked_submitters")
      .upsert({ submitter_hash: input.submitter_hash, country: input.country ?? null, reason: input.reason ?? null }, { onConflict: "submitter_hash" });
    if (error) throw error;
  } else if (input.action === "unblock") {
    await db.from("blocked_submitters").delete().eq("submitter_hash", input.submitter_hash);
  } else {
    await saveSubmissionRules({ allowed_countries: [...new Set(input.allowed_countries)] });
  }
  await auditStaff(supabase, user.id, { action: `senders.${input.action}`, resourceType: "submitter" });
  return json({ ok: true });
});
