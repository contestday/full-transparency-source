import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, json, parseJson } from "@/lib/http";
import { createWatcher } from "@/lib/watchers";
import { loadSampleWatcher, saveSampleWatcher } from "@/lib/sample-watcher";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The public sample watch view (admin only). */
export const GET = handle(async () => {
  await requireRole(["admin"]);
  const s = await loadSampleWatcher();
  return json(s ? { exists: true, locked: s.locked, token: s.token } : { exists: false });
});

export const POST = handle(async (request: Request) => {
  const { user, supabase } = await requireRole(["admin"]);
  const { action } = await parseJson(request, z.object({ action: z.enum(["create", "lock", "unlock"]) }));
  let s = await loadSampleWatcher();
  if (action === "create" && !s) {
    const { watcher, token } = await createWatcher("sample-watcher");
    s = { watcherId: watcher.id, token, locked: false };
  } else if (s && (action === "lock" || action === "unlock")) {
    s = { ...s, locked: action === "lock" };
  }
  await saveSampleWatcher(s);
  await auditStaff(supabase, user.id, { action: `sample_watcher.${action}`, resourceType: "watcher", resourceId: s?.watcherId ?? undefined });
  return json(s ? { exists: true, locked: s.locked, token: s.token } : { exists: false });
});
