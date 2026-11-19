import { handle, HttpError, json, parseJson } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { enforceRateLimits } from "@/lib/rate-limit";
import { assertSenderAllowed, requestCountry } from "@/lib/submission-guard";
import { geofenceSubmissionSchema, GeofenceValidationError, looksAutomated } from "@/lib/geofence/submission";
import { parseBounds } from "@/lib/geo";
import { makeReference, randomCode, sha256Hex } from "@/lib/crypto";
import { optionalEnv } from "@/lib/env";
import { notifyAdmins } from "@/lib/notify";
import { auditSystem } from "@/lib/audit";
import { createWatcher, findWatcher } from "@/lib/watchers";
import { assertNotLockedSample } from "@/lib/sample-watcher";
import { applyWantGrowth, buildWantGrowth, buildWatchArea, grewMessage, loadWatchAreas, saveWatchArea, tierContext, type WatchAreaRow } from "@/lib/watch-areas";
import { updateLiveStatus } from "@/lib/jobs/update-live-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anonymous submission of a watch area (wide, local or location). Every area
 * belongs to a private watch link: an existing one, or a new one. Wide areas
 * appear on the owner's private map; local areas and locations are sealed
 * with the watcher's link and never shown to the owner.
 */
export const POST = handle(async (request: Request) => {
  const input = await parseJson(request, geofenceSubmissionSchema);
  if (looksAutomated(input.form_started_at, input.website)) {
    // Respond as if accepted so bots learn nothing; nothing is stored.
    return json({ reference: makeReference("G"), withdrawal_code: randomCode(10), watch_token: randomCode(24) }, { status: 201 });
  }
  if (!input.tier) throw new HttpError(422, "Choose Wish, Want or Location. Please reload the page.");

  const submitterHash = await enforceRateLimits(request, [
    { name: "geofence:hour", windowSeconds: 3600, max: 10 },
    { name: "geofence:day", windowSeconds: 86400, max: 20 },
  ]);
  // Blocked senders and countries outside the allowed list are refused.
  const country = requestCountry(request);
  await assertSenderAllowed(submitterHash, country);

  // The watcher's existing areas decide the size rules.
  let existing: { id: string; token: string } | null = null;
  let others: Awaited<ReturnType<typeof loadWatchAreas>> = [];
  if (input.watch_token) {
    const w = await findWatcher(input.watch_token);
    if (!w || w.status !== "active") throw new HttpError(404, "That watch link is not recognised");
    await assertNotLockedSample(w.id);
    others = await loadWatchAreas(w.id, input.watch_token);
    existing = { id: w.id, token: input.watch_token };
  }
  // A new link's token is made first: local areas and locations are sealed with it.
  let token = existing?.token ?? null;
  let watcherId = existing?.id ?? null;
  let newToken: string | null = null;
  const build = async (t: string) => {
    try {
      return await buildWatchArea({
        tier: input.tier!,
        mode: input.wide_mode ?? null,
        shape: input.shape,
        name: input.approximate_location,
        note: input.description,
        token: t,
        others: tierContext(others),
        bounds: parseBounds(optionalEnv("GEOFENCE_BOUNDS")),
      });
    } catch (err) {
      if (err instanceof GeofenceValidationError) throw new HttpError(422, err.message);
      throw err;
    }
  };
  let row: WatchAreaRow;
  if (token) row = await build(token);
  else {
    // Validate before creating the link, so a refused area leaves nothing behind.
    await build("VALIDATIONONLY0000000000");
    const created = await createWatcher(submitterHash);
    watcherId = created.watcher.id;
    if (country) await createServiceClient().from("watchers").update({ submitter_country: country }).eq("id", watcherId);
    token = newToken = created.token;
    row = await build(token);
  }
  // A new Location near the edge of a Want circle: that circle grows (checked before saving).
  let growth: Awaited<ReturnType<typeof buildWantGrowth>> = [];
  if (row.grow_want?.length && input.shape.type === "location") {
    try {
      growth = await buildWantGrowth({ grows: row.grow_want, areas: others, point: input.shape.center, token, bounds: parseBounds(optionalEnv("GEOFENCE_BOUNDS")) });
    } catch (err) {
      if (err instanceof GeofenceValidationError) throw new HttpError(422, err.message);
      throw err;
    }
  }

  const reference = makeReference("G");
  const withdrawalCode = randomCode(10);
  const id = await saveWatchArea(row, { id: null, reference, watcherId: watcherId!, withdrawalCodeHash: await sha256Hex(withdrawalCode), submitterHash });
  const supabase = createServiceClient();
  if (country) await supabase.from("geofences").update({ submitter_country: country }).eq("id", id);
  await supabase.from("geofence_events").insert({ geofence_id: id, event_type: "submitted", observed_at: new Date().toISOString() });
  await auditSystem("anonymous", { action: "geofence.submitted", resourceType: "geofence", resourceId: id });
  await notifyAdmins({
    event: "geofence_submitted",
    title: row.tier === "wide" ? "New Wish area" : row.tier === "local" ? "New Want area" : "A watcher added a private Location",
    body:
      row.tier === "location"
        ? `Reference ${reference}: private to its watcher (not shown to you).`
        : `Reference ${reference}, in effect from now. See it on the private map.`,
    url: "/admin/geofences",
  });
  if (growth.length) await applyWantGrowth(growth, watcherId!, submitterHash);
  if (row.tier !== "location" || growth.length) await updateLiveStatus().catch(() => undefined);

  const messages = [...(row.grew ? [grewMessage(row.grew)] : []), ...growth.map((g) => grewMessage(g.row.grew!, g.name))];
  return json({ reference, withdrawal_code: withdrawalCode, watch_token: newToken, message: messages.join(" ") || null }, { status: 201 });
});
