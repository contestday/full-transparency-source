import { z } from "zod";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { findWatcher } from "@/lib/watchers";
import { assertNotLockedSample } from "@/lib/sample-watcher";
import { policeReportsForWatcher, setWatcherPoliceReports } from "@/lib/police-reports";
import { auditSystem } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

async function watcherFor(token: string) {
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  return w;
}

/** Is police reporting available (my switch) and on for this watch link (the watcher's own choice)? */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-police:min", windowSeconds: 60, max: 60 }]);
  const w = await watcherFor((await ctx.params).token);
  return json(await policeReportsForWatcher(w.id));
});

/** The watcher turns police reporting on or off for their own link (only while it's available). */
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-police:hour", windowSeconds: 3600, max: 20 }]);
  const w = await watcherFor((await ctx.params).token);
  await assertNotLockedSample(w.id);
  const { enabled } = await parseJson(request, z.object({ enabled: z.boolean() }));
  const state = await policeReportsForWatcher(w.id);
  if (!state.available) throw new HttpError(404, "Not found");
  await setWatcherPoliceReports(w.id, enabled);
  await auditSystem("anonymous", { action: enabled ? "watcher.police_reports_on" : "watcher.police_reports_off", resourceType: "watcher", resourceId: w.id });
  return json({ available: true, enabled });
});
