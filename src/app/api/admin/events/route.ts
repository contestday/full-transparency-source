import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/server";
import { makeReference } from "@/lib/crypto";
import { auditStaff } from "@/lib/audit";
import { buildPlaces, eventSubmissionSchema, includesHome, resolveWhen } from "@/lib/events/server";
import { EventRuleError, type Recurrence } from "@/lib/events/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ownerSchema = eventSubmissionSchema.omit({ watch_token: true, form_started_at: true, website: true, level: true });

/**
 * One of my own bans: a place and time I mustn't be. Public (like plans), no
 * watch link and no 48 hours' notice. While I'm in it, everyone sees red.
 */
export const POST = handle(async (request: Request) => {
  const { user, supabase } = await requireRole(["admin"]);
  const input = await parseJson(request, ownerSchema);
  let when: { startsAt: number; endsAt: number; recurrence: Recurrence | null };
  let places;
  try {
    when = resolveWhen(input);
    places = buildPlaces(input.places);
  } catch (err) {
    if (err instanceof EventRuleError) throw new HttpError(422, err.message);
    throw err;
  }
  const service = createServiceClient();
  const reference = makeReference("E");
  const { data: ev, error } = await service
    .from("watch_events")
    .insert({
      reference,
      watcher_id: null,
      is_owner: true,
      title: input.title,
      details: input.details || null,
      level: "demand",
      starts_at: new Date(when.startsAt).toISOString(),
      ends_at: new Date(when.endsAt).toISOString(),
      includes_home: await includesHome(places),
      recurrence: when.recurrence,
      submitter_hash: "owner",
    })
    .select("id")
    .single();
  if (error) throw error;
  const { error: placeErr } = await service.from("watch_event_places").insert(places.map((p) => ({ ...p, event_id: ev.id })));
  if (placeErr) {
    await service.from("watch_events").delete().eq("id", ev.id);
    throw placeErr;
  }
  await auditStaff(supabase, user.id, { action: "watch_event.owner_set", resourceType: "watch_event", resourceId: ev.id });
  return json({ reference }, { status: 201 });
});
