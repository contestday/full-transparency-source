import { handle, HttpError, json, parseJson } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { enforceRateLimits } from "@/lib/rate-limit";
import { assertSenderAllowed, requestCountry } from "@/lib/submission-guard";
import { looksAutomated } from "@/lib/geofence/submission";
import { makeReference, randomCode } from "@/lib/crypto";
import { notifyAdmins } from "@/lib/notify";
import { auditSystem } from "@/lib/audit";
import { createWatcher, findWatcher, loadOwnerProfile } from "@/lib/watchers";
import { assertNotLockedSample } from "@/lib/sample-watcher";
import { buildPlaces, eventSubmissionSchema, includesHome, resolveWhen } from "@/lib/events/server";
import { checkEventWindow, describeRecurrence, EVENT_LEVEL_META, EventRuleError, homeAssurance, type Recurrence } from "@/lib/events/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" });

/**
 * Set an event: somewhere the watcher would rather I wasn't, for that time
 * only. It belongs to a watch link (an existing one, or a new one). Not
 * sealed: I'm told the event, its places and times. Never public.
 */
export const POST = handle(async (request: Request) => {
  const input = await parseJson(request, eventSubmissionSchema);
  if (looksAutomated(input.form_started_at, input.website)) {
    return json({ reference: makeReference("E"), watch_token: input.watch_token ? null : randomCode(24) }, { status: 201 });
  }
  let startsAt: number;
  let endsAt: number;
  let recurrence: Recurrence | null;
  let places;
  try {
    ({ startsAt, endsAt, recurrence } = resolveWhen(input));
    checkEventWindow(startsAt, endsAt);
    places = buildPlaces(input.places);
  } catch (err) {
    if (err instanceof EventRuleError) throw new HttpError(422, err.message);
    throw err;
  }

  const submitterHash = await enforceRateLimits(request, [
    { name: "event:hour", windowSeconds: 3600, max: 6 },
    { name: "event:day", windowSeconds: 86400, max: 15 },
  ]);
  const country = requestCountry(request);
  await assertSenderAllowed(submitterHash, country);

  const supabase = createServiceClient();
  let watcherId: string;
  let newToken: string | null = null;
  if (input.watch_token) {
    const w = await findWatcher(input.watch_token.toUpperCase());
    if (!w || w.status !== "active") throw new HttpError(404, "That watch link is not recognised");
    await assertNotLockedSample(w.id);
    watcherId = w.id;
  } else {
    const created = await createWatcher(submitterHash);
    watcherId = created.watcher.id;
    newToken = created.token;
    if (country) await supabase.from("watchers").update({ submitter_country: country }).eq("id", watcherId);
  }

  const home = await includesHome(places);
  const reference = makeReference("E");
  const { data: ev, error } = await supabase
    .from("watch_events")
    .insert({
      reference,
      watcher_id: watcherId,
      title: input.title,
      details: input.details || null,
      level: input.level,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      includes_home: home,
      recurrence,
      submitter_hash: submitterHash,
      submitter_country: country,
    })
    .select("id")
    .single();
  if (error) {
    if (/48 hours|5 years/.test(error.message)) throw new HttpError(422, error.message);
    throw error;
  }
  const { error: placeErr } = await supabase.from("watch_event_places").insert(places.map((p) => ({ ...p, event_id: ev.id })));
  if (placeErr) {
    await supabase.from("watch_events").delete().eq("id", ev.id);
    throw placeErr;
  }
  await auditSystem("anonymous", { action: "watch_event.set", resourceType: "watch_event", resourceId: ev.id });
  const owner = await loadOwnerProfile();
  await notifyAdmins({
    event: "watch_event_set",
    title: `New event (${EVENT_LEVEL_META[input.level].label}): ${input.title}`,
    body: `${reference}: ${places.map((p) => p.name).join(", ")}, ${recurrence ? `${describeRecurrence(recurrence, { end: true })}, ` : ""}${fmt(new Date(startsAt).toISOString())} to ${fmt(new Date(endsAt).toISOString())}.${home ? " It includes your home." : ""}`,
    url: "/admin/events",
  });
  return json(
    { reference, watch_token: newToken, includes_home: home, home_note: home ? homeAssurance(owner.first) : null },
    { status: 201 },
  );
});
