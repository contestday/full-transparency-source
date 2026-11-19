import { z } from "zod";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { stopContact } from "@/lib/watcher-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The recipient stops automatic reports (link at the foot of every alert). */
export const POST = handle(async (request: Request) => {
  await enforceRateLimits(request, [{ name: "contact-stop:hour", windowSeconds: 3600, max: 30 }]);
  const { t } = await parseJson(request, z.object({ t: z.string().min(10).max(100) }));
  if (!(await stopContact(t))) throw new HttpError(404, "This link isn't valid (it may already have been removed)");
  return json({ ok: true });
});
