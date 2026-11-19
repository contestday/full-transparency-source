import { z } from "zod";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import { findWatcher, REMINDER_CHOICES } from "@/lib/watchers";
import { assertNotLockedSample } from "@/lib/sample-watcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** How often to remind this watcher while I'm in one of their Want areas, or Locations (0 = not at all). */
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [{ name: "watch-reminders:hour", windowSeconds: 3600, max: 30 }]);
  const { token } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  await assertNotLockedSample(w.id);
  const choice = z.number().int().refine((m) => (REMINDER_CHOICES as readonly number[]).includes(m));
  const { kind, minutes } = await parseJson(request, z.object({ kind: z.enum(["want", "location"]), minutes: choice }));
  await createServiceClient()
    .from("watchers")
    .update(kind === "want" ? { reminder_minutes: minutes } : { reminder_location_minutes: minutes })
    .eq("id", w.id);
  return json({ ok: true });
});
