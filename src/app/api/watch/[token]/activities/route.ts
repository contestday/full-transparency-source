import { handle, HttpError, json, parseJson } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import { assertSenderAllowed, requestCountry } from "@/lib/submission-guard";
import { findWatcher } from "@/lib/watchers";
import { assertNotLockedSample } from "@/lib/sample-watcher";
import { makeReference } from "@/lib/crypto";
import { notifyAdmins } from "@/lib/notify";
import { auditSystem } from "@/lib/audit";
import { ACTIVITY_LEVEL_META, activityInputSchema, resolveActivity } from "@/lib/activities";
import { loadActivityOptions, loadOwnerActivities, loadWatcherActivities } from "@/lib/activities-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

async function activeWatcher(token: string) {
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  return w;
}

const PRIVATE = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };

/** This watch link's activities, my public bans, and the list to choose from. */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  await enforceRateLimits(request, [{ name: "watch:min", windowSeconds: 60, max: 30 }]);
  const w = await activeWatcher(token);
  const [mine, bans, options] = await Promise.all([loadWatcherActivities(w.id), loadOwnerActivities(), loadActivityOptions()]);
  return json({ activities: mine, bans, options }, { headers: PRIVATE });
});

/** Add an activity this watcher would rather I didn't do. Only they and I see it. */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  const submitterHash = await enforceRateLimits(request, [
    { name: "activity:hour", windowSeconds: 3600, max: 10 },
    { name: "activity:day", windowSeconds: 86400, max: 30 },
  ]);
  const input = await parseJson(request, activityInputSchema);
  if (!input.level) throw new HttpError(422, "Choose Wish, Want or Demand.");
  const resolved = resolveActivity(input, await loadActivityOptions());
  if ("error" in resolved) throw new HttpError(422, resolved.error);
  const country = requestCountry(request);
  await assertSenderAllowed(submitterHash, country);
  const w = await activeWatcher(token);
  await assertNotLockedSample(w.id);
  const reference = makeReference("A");
  const { data, error } = await createServiceClient()
    .from("banned_activities")
    .insert({
      reference,
      watcher_id: w.id,
      option_key: resolved.key,
      label: resolved.label,
      details: input.details || null,
      level: input.level,
      submitter_hash: submitterHash,
      submitter_country: country,
    })
    .select("id")
    .single();
  if (error) throw error;
  await auditSystem("anonymous", { action: "banned_activity.set", resourceType: "banned_activity", resourceId: data.id });
  await notifyAdmins({
    event: "watch_activity_set",
    title: `New activity (${ACTIVITY_LEVEL_META[input.level].label}): ${resolved.label}`,
    body: `${reference}: a watcher would rather you didn't do this.${input.details ? ` "${input.details.slice(0, 200)}"` : ""}`,
    url: "/admin/events",
  });
  return json({ reference }, { status: 201, headers: PRIVATE });
});
