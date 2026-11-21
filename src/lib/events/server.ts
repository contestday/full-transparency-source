import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { normaliseGeofence, GeofenceValidationError } from "@/lib/geofence/submission";
import { parseBounds, type LatLng } from "@/lib/geo";
import { optionalEnv } from "@/lib/env";
import { loadHome } from "@/lib/home";
import type { AreaGeometry } from "@/lib/geofence/area-geometry";
import { haversineMeters } from "@/lib/geo";
import {
  EVENT_LEVEL_META,
  EVENT_RULES,
  EventRuleError,
  checkRecurrence,
  eventOnAt,
  eventPhase,
  insidePlace,
  placesInclude,
  type EventLevel,
  type EventPhase,
  seriesWindow,
  type Recurrence,
} from "@/lib/events/rules";

const point = z.object({ lat: z.number(), lng: z.number() });

export const eventPlaceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("venue"),
    name: z.string().trim().min(1).max(200),
    center: point,
    radius_m: z.number().min(EVENT_RULES.venueMinRadiusM).max(EVENT_RULES.venueMaxRadiusM),
  }),
  z.object({
    kind: z.literal("place"),
    name: z.string().trim().min(1).max(200),
    geojson: z.object({ type: z.enum(["Polygon", "MultiPolygon"]), coordinates: z.array(z.unknown()) }),
  }),
]);
export type EventPlaceInput = z.infer<typeof eventPlaceSchema>;

export const eventSubmissionSchema = z.object({
  watch_token: z.string().max(100).optional().nullable(),
  title: z.string().trim().min(1, "Give the event a name").max(120),
  details: z.string().trim().max(2000).optional().nullable(),
  level: z.enum(["wish", "want", "demand"]),
  starts_at: z.string().max(40).optional().nullable(),
  ends_at: z.string().max(40).optional().nullable(),
  places: z.array(eventPlaceSchema).min(1, "Add at least one place").max(EVENT_RULES.maxPlaces),
  /** Repeating: weekly on these days between these UK times, from first_date to last_date. starts_at / ends_at are then ignored. */
  recurrence: z
    .object({
      freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
      interval: z.number().int().min(1).max(99).default(1),
      days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
      by: z.enum(["day", "nth"]).optional(),
      day: z.number().int().min(1).max(31).optional(),
      nth: z.number().int().min(-1).max(4).optional(),
      weekday: z.number().int().min(0).max(6).optional(),
      month: z.number().int().min(1).max(12).optional(),
      start_time: z.string().regex(/^\d{2}:\d{2}$/),
      end_time: z.string().regex(/^\d{2}:\d{2}$/),
      first_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end: z.discriminatedUnion("type", [
        z.object({ type: z.literal("date"), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
        z.object({ type: z.literal("count"), count: z.number().int().min(1).max(999) }),
        z.object({ type: z.literal("never") }),
      ]),
    })
    .optional()
    .nullable(),
  form_started_at: z.number(),
  website: z.string().max(200).default(""),
});
export type EventSubmission = z.infer<typeof eventSubmissionSchema>;

/** The event's whole window, and its repeat pattern if it has one. Throws EventRuleError. */
export function resolveWhen(input: Pick<EventSubmission, "starts_at" | "ends_at" | "recurrence">): { startsAt: number; endsAt: number; recurrence: Recurrence | null } {
  if (!input.recurrence) {
    const startsAt = Date.parse(input.starts_at ?? "");
    const endsAt = Date.parse(input.ends_at ?? "");
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) throw new EventRuleError("Choose when the event starts and ends.");
    if (endsAt <= startsAt) throw new EventRuleError("The event must end after it starts.");
    return { startsAt, endsAt, recurrence: null };
  }
  const { first_date, end, ...r } = input.recurrence;
  const monthly = r.freq === "monthly" || r.freq === "yearly";
  const recurrence: Recurrence = {
    freq: r.freq,
    interval: r.interval,
    ...(r.freq === "weekly" ? { days: [...new Set(r.days ?? [])].sort() } : {}),
    ...(monthly ? (r.by === "nth" ? { by: "nth" as const, nth: r.nth, weekday: r.weekday } : { by: "day" as const, day: r.day }) : {}),
    ...(r.freq === "yearly" ? { month: r.month } : {}),
    start_time: r.start_time,
    end_time: r.end_time,
    anchor: first_date,
    count: end.type === "count" ? end.count : null,
    until: end.type === "date" ? end.until : null,
  };
  checkRecurrence(recurrence);
  if (end.type === "date" && end.until < first_date) throw new EventRuleError("The end date must be on or after the start date.");
  const w = seriesWindow(recurrence, first_date, { until: recurrence.until, count: recurrence.count });
  if (!w) throw new EventRuleError("No day matches that repeat between those dates.");
  return { startsAt: w.startsAt, endsAt: w.endsAt, recurrence };
}

export interface EventPlaceRow {
  id?: string;
  position: number;
  name: string;
  kind: "venue" | "place";
  center_lat: number;
  center_lng: number;
  radius_m: number | null;
  geojson: AreaGeometry;
  area_m2: number;
}

/** Check and normalise the places (venue circles, or named town / city outlines). */
export function buildPlaces(places: EventPlaceInput[]): EventPlaceRow[] {
  const bounds = parseBounds(optionalEnv("GEOFENCE_BOUNDS"));
  return places.map((p, i) => {
    try {
      const n =
        p.kind === "venue"
          ? normaliseGeofence({ type: "circle", center: p.center, radius_m: p.radius_m }, bounds)
          : normaliseGeofence({ type: "boundary", name: p.name, geojson: p.geojson } as Parameters<typeof normaliseGeofence>[0], bounds);
      if (p.kind === "place" && n.areaM2 > EVENT_RULES.placeMaxAreaM2) {
        throw new EventRuleError(`“${p.name}” is too big for an event. Choose a town or city, or a venue with a radius.`);
      }
      return {
        position: i,
        name: p.name,
        kind: p.kind,
        center_lat: n.center.lat,
        center_lng: n.center.lng,
        radius_m: n.radiusM,
        geojson: JSON.parse(n.geojson) as AreaGeometry,
        area_m2: n.areaM2,
      };
    } catch (err) {
      if (err instanceof GeofenceValidationError) throw new EventRuleError(`“${p.name}”: ${err.message}`);
      throw err;
    }
  });
}

/** Does any place include my home (the private home point)? */
export async function includesHome(places: { geojson: AreaGeometry }[]): Promise<boolean> {
  const home = await loadHome().catch(() => null);
  return home ? placesInclude(places, home) : false;
}

export interface WatchEvent {
  id: string;
  reference: string;
  watcher_id: string | null;
  /** One of my own bans: public. */
  is_owner: boolean;
  title: string;
  details: string | null;
  level: EventLevel;
  starts_at: string;
  ends_at: string;
  status: "active" | "cancelled";
  cancelled_at: string | null;
  includes_home: boolean;
  recurrence: Recurrence | null;
  created_at: string;
  phase: EventPhase;
  places: EventPlaceRow[];
}

const EVENT_COLS = "id, reference, watcher_id, title, details, level, starts_at, ends_at, status, cancelled_at, includes_home, recurrence, is_owner, created_at";
const PLACE_COLS = "id, event_id, position, name, kind, center_lat, center_lng, radius_m, geojson, area_m2";

async function withPlaces(rows: Omit<WatchEvent, "places" | "phase">[]): Promise<WatchEvent[]> {
  if (!rows.length) return [];
  const { data: places, error } = await createServiceClient()
    .from("watch_event_places")
    .select(PLACE_COLS)
    .in("event_id", rows.map((r) => r.id))
    .order("position");
  if (error) throw error;
  const byEvent = new Map<string, EventPlaceRow[]>();
  for (const p of (places ?? []) as (EventPlaceRow & { event_id: string })[]) {
    const list = byEvent.get(p.event_id) ?? [];
    list.push(p);
    byEvent.set(p.event_id, list);
  }
  const now = Date.now();
  return rows.map((r) => ({ ...r, phase: eventPhase(r, now), places: byEvent.get(r.id) ?? [] }));
}

/** One watch link's events, newest start first. */
export async function loadWatcherEvents(watcherId: string): Promise<WatchEvent[]> {
  const { data, error } = await createServiceClient()
    .from("watch_events")
    .select(EVENT_COLS)
    .eq("watcher_id", watcherId)
    .order("starts_at", { ascending: true })
    .limit(200);
  if (error) {
    if (/watch_events/.test(error.message)) return []; // migration not applied yet
    throw error;
  }
  return withPlaces((data ?? []) as Omit<WatchEvent, "places" | "phase">[]);
}

/** Every event (owner only). */
export async function loadAllEvents(): Promise<WatchEvent[]> {
  const { data, error } = await createServiceClient().from("watch_events").select(EVENT_COLS).order("starts_at", { ascending: true }).limit(1000);
  if (error) {
    if (/watch_events/.test(error.message)) return [];
    throw error;
  }
  return withPlaces((data ?? []) as Omit<WatchEvent, "places" | "phase">[]);
}

/** My own bans (public): everything but cancelled ones. */
export async function loadOwnerEvents(): Promise<WatchEvent[]> {
  const { data, error } = await createServiceClient()
    .from("watch_events")
    .select(EVENT_COLS)
    .eq("is_owner", true)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true })
    .limit(500);
  if (error) {
    if (/watch_events|is_owner/.test(error.message)) return [];
    throw error;
  }
  return withPlaces((data ?? []) as Omit<WatchEvent, "places" | "phase">[]);
}

/** My own restricted areas (public): name (first line) and shape only. */
export async function loadOwnerAreas(): Promise<{ reference: string; name: string; geojson: AreaGeometry }[]> {
  const { data } = await createServiceClient()
    .from("geofences_geojson")
    .select("reference, description, geojson")
    .eq("origin", "admin")
    .eq("status", "active");
  return ((data ?? []) as { reference: string; description: string | null; geojson: AreaGeometry | null }[]).flatMap((a) =>
    a.geojson ? [{ reference: a.reference, name: (a.description ?? "").split("\n")[0], geojson: a.geojson }] : [],
  );
}

/** Am I inside one of my own bans right now? (Red for everyone.) */
export async function insideOwnerEvent(): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from("watch_event_state")
    .select("place_id, watch_event_places!inner(watch_events!inner(is_owner))")
    .eq("inside", true)
    .eq("watch_event_places.watch_events.is_owner", true)
    .limit(1);
  return !error && (data ?? []).length > 0;
}

/** Events on right now (not cancelled), with their places. */
async function loadEventsOnNow(): Promise<WatchEvent[]> {
  const now = new Date().toISOString();
  const { data, error } = await createServiceClient()
    .from("watch_events")
    .select(EVENT_COLS)
    .eq("status", "active")
    .lte("starts_at", now)
    .gt("ends_at", now);
  if (error) {
    if (/watch_events/.test(error.message)) return [];
    throw error;
  }
  // Repeating events: only during one of their times.
  const nowMs = Date.now();
  return withPlaces(((data ?? []) as Omit<WatchEvent, "places" | "phase">[]).filter((e) => eventOnAt(e, nowMs)));
}

/** The hidden zone around home: being in it is "at home" (never counts). */
export async function loadAtHomeZone(): Promise<{ lat: number; lng: number; radiusM: number } | null> {
  const { data } = await createServiceClient().from("publication_rules").select("configuration, enabled").eq("rule_type", "exclusion_zone").eq("enabled", true);
  const home = (data ?? []).map((r) => r.configuration as Record<string, unknown>).find((c) => c.label === "Home");
  const lat = Number(home?.lat);
  const lng = Number(home?.lng);
  const radiusM = Number(home?.radius_m);
  return Number.isFinite(lat) && Number.isFinite(lng) && radiusM > 0 ? { lat, lng, radiusM } : null;
}

export function isAtHome(p: LatLng, zone: { lat: number; lng: number; radiusM: number } | null): boolean {
  return Boolean(zone && haversineMeters(p, zone) <= zone.radiusM);
}

const ukTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/**
 * Check the latest live position against events that are on now, record
 * entries and exits, and tell the watcher who set the event and me. Places of
 * events that aren't on (ended, cancelled, not started) are closed quietly.
 * With no new readings, the last known position is used, so an event starting
 * while I'm already there is noticed.
 */
export async function evaluateEvents(observations: { observed_at: string; lat: number; lng: number }[] = []): Promise<void> {
  const supabase = createServiceClient();
  let latest = [...observations].sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0] ?? null;
  if (!latest) {
    const { data } = await supabase
      .from("location_observations")
      .select("observed_at, lat, lng")
      .in("source", ["followmee", "ingest_api"])
      .eq("validation_status", "valid")
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latest = (data as typeof latest) ?? null;
  }
  const [events, { data: stateRows, error: stateErr }, homeZone] = await Promise.all([loadEventsOnNow(), supabase.from("watch_event_state").select("place_id, inside, since"), loadAtHomeZone()]);
  if (stateErr) {
    if (/watch_event_state/.test(stateErr.message)) return;
    throw stateErr;
  }
  const states = new Map((stateRows ?? []).map((s) => [s.place_id as string, s as { place_id: string; inside: boolean; since: string | null }]));
  const onPlaces = new Set(events.flatMap((e) => e.places.map((p) => p.id!)));
  const now = new Date().toISOString();

  // Close places whose event is no longer on.
  const stale = [...states.values()].filter((s) => s.inside && !onPlaces.has(s.place_id));
  if (stale.length) await supabase.from("watch_event_state").update({ inside: false, since: now }).in("place_id", stale.map((s) => s.place_id));
  if (!latest) return;

  const atHome = isAtHome(latest, homeZone);
  const upserts: Record<string, unknown>[] = [];
  const changes: { event: WatchEvent; place: EventPlaceRow; type: "enter" | "exit" }[] = [];
  for (const e of events) {
    for (const p of e.places) {
      const was = states.get(p.id!)?.inside ?? false;
      const inside = insidePlace(latest, p.geojson, was, atHome);
      upserts.push({ place_id: p.id, inside, since: inside !== was ? latest.observed_at : (states.get(p.id!)?.since ?? latest.observed_at), last_observed_at: latest.observed_at });
      if (inside !== was) changes.push({ event: e, place: p, type: inside ? "enter" : "exit" });
    }
  }
  if (upserts.length) await supabase.from("watch_event_state").upsert(upserts, { onConflict: "place_id" });
  if (!changes.length) return;
  await supabase.from("watch_event_log").insert(changes.map((c) => ({ event_id: c.event.id, place_id: c.place.id, event_type: c.type, observed_at: latest!.observed_at })));

  const { notifyAdmins } = await import("@/lib/notify");
  const { loadOwnerProfile, pushToWatcher, liveMarkerEnabled } = await import("@/lib/watchers");
  const owner = await loadOwnerProfile();
  const alertsOn = await liveMarkerEnabled();
  for (const c of changes) {
    const level = EVENT_LEVEL_META[c.event.level].label;
    const verb = c.type === "enter" ? "may be at" : "may have left";
    const time = ukTime(latest.observed_at);
    if (c.event.is_owner) {
      await notifyAdmins({
        event: c.type === "enter" ? "watch_event_enter" : "watch_event_exit",
        title: `${c.type === "enter" ? "Entered" : "Left"} a place you're banned from: ${c.event.title}`,
        body: `GPS at ${time}: ${c.type === "enter" ? "entered" : "left"} ${c.place.name} (${c.event.reference}). Everyone sees red while you're there.`,
        url: "/admin/events",
      });
      continue;
    }
    await notifyAdmins({
      event: c.type === "enter" ? "watch_event_enter" : "watch_event_exit",
      title: `${c.type === "enter" ? "Entered" : "Left"} event (${level}): ${c.event.title}`,
      body: `GPS at ${time}: ${c.type === "enter" ? "entered" : "left"} ${c.place.name}, for the event “${c.event.title}” (${c.event.reference}).`,
      url: "/admin/events",
    });
    if (!alertsOn) continue;
    if (!c.event.watcher_id) continue;
    await supabase.from("watcher_alerts").insert({ watcher_id: c.event.watcher_id, event: c.type, tier: "event", outside: false, reference: c.event.reference, since: latest.observed_at });
    await pushToWatcher(
      c.event.watcher_id!,
      JSON.stringify({
        title: `${owner.first} ${verb} your event: ${c.event.title}`,
        body:
          `You are receiving this because you asked to be notified of ${owner.name}'s movements through the Full Transparency app. ` +
          `Our records indicate ${owner.first} ${verb} ${c.place.name}, which you marked for your event “${c.event.title}” (${level}), at ${time}. For more details, open the site.`,
        url: "/watch?alert=1",
      }),
    ).catch(() => undefined);
  }
}

/** Am I inside a place of one of this watcher's events right now? (For their marker colour.) */
export async function insideWatcherEvent(watcherId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("watch_event_state")
    .select("place_id, watch_event_places!inner(event_id, watch_events!inner(watcher_id, status, starts_at, ends_at, recurrence))")
    .eq("inside", true)
    .eq("watch_event_places.watch_events.watcher_id", watcherId);
  if (error) return false;
  const now = Date.now();
  return (data ?? []).some((r) => {
    const e = (r as unknown as { watch_event_places: { watch_events: { status: string; starts_at: string; ends_at: string; recurrence: Recurrence | null } } }).watch_event_places.watch_events;
    return eventPhase(e, now) === "on";
  });
}

/** Am I inside any event's place right now? (For my own dashboard colour.) */
export async function insideAnyEvent(): Promise<boolean> {
  const { data, error } = await createServiceClient().from("watch_event_state").select("place_id").eq("inside", true).limit(1);
  return !error && (data ?? []).length > 0;
}
