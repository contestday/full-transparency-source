import { z } from "zod";
import { policeReportsForWatcher } from "@/lib/police-reports";
import { handle, HttpError, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { findWatcher } from "@/lib/watchers";
import { loadSampleWatcher } from "@/lib/sample-watcher";
import { auditSystem } from "@/lib/audit";
import { loadMovementLog, MOVEMENT_MAX_DAYS } from "@/lib/movement-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ token: string }> };

const query = z.object({ from: z.iso.date(), to: z.iso.date() });

/**
 * The full movement record (every stay, journey and GPS reading) for the
 * dates, for a watcher's evidence report. Only for a watch link that has
 * reporting turned on, never the public sample. Visits stop at now.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [
    { name: "watch-movements:min", windowSeconds: 60, max: 6 },
    { name: "watch-movements:day", windowSeconds: 86400, max: 60 },
  ]);
  const { token } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  if (!(await policeReportsForWatcher(w.id)).enabled) throw new HttpError(404, "Not found");
  const sample = await loadSampleWatcher();
  if (sample?.watcherId === w.id) throw new HttpError(403, "The public sample has no movement record. Use your own watch link.");

  const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
  const fromMs = Date.parse(`${q.from}T00:00:00Z`);
  const toMs = Math.min(Date.parse(`${q.to}T23:59:59.999Z`), Date.now());
  if (fromMs > toMs) return json({ from: q.from, to: q.to, stays: [], journeys: [], points: [], truncated: false });
  if (toMs - fromMs > MOVEMENT_MAX_DAYS * 86_400_000) throw new HttpError(400, `Choose ${MOVEMENT_MAX_DAYS} days or fewer for the full movement record`);

  const log = await loadMovementLog(new Date(fromMs).toISOString(), new Date(toMs).toISOString());
  await auditSystem("anonymous", { action: "watcher.movement_record", resourceType: "watcher", resourceId: w.id });
  return json(log, { headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
});
