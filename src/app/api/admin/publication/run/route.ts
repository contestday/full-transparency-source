import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { processPublication } from "@/lib/jobs/process-publication";
import { pollFollowMee } from "@/lib/jobs/poll-followmee";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Manually trigger jobs from the admin UI. ?job=publish|followmee */
export const POST = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const job = new URL(request.url).searchParams.get("job") ?? "publish";
  const result = job === "followmee" ? await pollFollowMee() : await processPublication();
  await auditStaff(supabase, user.id, { action: `job.${job}.manual_run`, resourceType: "job" });
  revalidatePath("/history");
  return json(result);
});
