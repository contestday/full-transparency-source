import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, json, parseJson } from "@/lib/http";
import { policeReportsEnabled, setPoliceReportsEnabled } from "@/lib/police-reports";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Police reporting on or off (admin only). */
export const GET = handle(async () => {
  await requireRole(["admin"]);
  return json({ enabled: await policeReportsEnabled() });
});

export const POST = handle(async (request: Request) => {
  const { user, supabase } = await requireRole(["admin"]);
  const { enabled } = await parseJson(request, z.object({ enabled: z.boolean() }));
  await setPoliceReportsEnabled(enabled);
  await auditStaff(supabase, user.id, { action: enabled ? "police_reports.on" : "police_reports.off", resourceType: "system_state" });
  return json({ enabled });
});
