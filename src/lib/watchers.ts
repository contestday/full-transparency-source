import "server-only";
import { sendNotification, setVapidDetails } from "web-push";
import { createServiceClient } from "@/lib/supabase/server";
import { randomCode, sha256Hex } from "@/lib/crypto";
import { computeWatcherStatus, LIVE_STATUS_META, type LiveStatus } from "@/lib/live-status";
import { loadWatchAreas, zoneAreas, type WatchArea } from "@/lib/watch-areas";
import { escrowAreaKey, unescrowAreaKey } from "@/lib/watch-seal";
import { zoneAt, type Tier, type WideMode } from "@/lib/geofence/tiers";
import type { AreaGeometry } from "@/lib/geofence/area-geometry";
import { liveHoldMs, optionalEnv } from "@/lib/env";
import { alertText, type AlertEvent } from "@/lib/alert-text";
import { loadHomeArea, type HomeArea } from "@/lib/home";


export interface Watcher {
  id: string;
  status: "active" | "revoked";
}

/** Random, non-sequential 4-digit label, e.g. "4827". A label only, never a credential. */
export function randomDisplayCode(): string {
  const n = new Uint16Array(1);
  crypto.getRandomValues(n);
  return String(1000 + (n[0] % 9000));
}

export async function createWatcher(submitterHash: string): Promise<{ watcher: Watcher; token: string }> {
  const token = randomCode(24);
  const supabase = createServiceClient();
  const base = { token_hash: await sha256Hex(token), submitter_hash: submitterHash };
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase
      .from("watchers")
      .insert({ ...base, display_code: randomDisplayCode() })
      .select("id, status")
      .single();
    if (!error) return { watcher: data as Watcher, token };
    if (/display_code/.test(error.message) && /column/.test(error.message)) break; // migration 0008 not applied
    if (!/duplicate key/.test(error.message)) throw error;
  }
  const { data, error } = await supabase.from("watchers").insert(base).select("id, status").single();
  if (error) throw error;
  return { watcher: data as Watcher, token };
}

export function isWatchTokenShape(token: string): boolean {
  return /^[A-Z0-9]{24}$/.test(token);
}

export async function findWatcher(token: string): Promise<Watcher | null> {
  if (!isWatchTokenShape(token)) return null;
  const { data } = await createServiceClient()
    .from("watchers")
    .select("id, status")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  return (data as Watcher | null) ?? null;
}

export async function liveMarkerEnabled(): Promise<boolean> {
  const { data } = await createServiceClient()
    .from("publication_rules")
    .select("enabled")
    .eq("rule_type", "live_status")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(data?.enabled);
}

/** One of the watcher's areas, as sent to their own browser. */
export interface WatcherArea {
  reference: string;
  tier: Tier;
  /** Wide areas: "inside" = don't go in, "outside" = don't leave it. */
  mode: WideMode | null;
  kind: "shape" | "beyond_home" | "location";
  name: string;
  note: string;
  /** Null for "beyond home" areas: their circle would reveal roughly where home is. */
  geojson: AreaGeometry | null;
  /** The shape as drawn, for editing. */
  shape: WatchArea["shape"];
  distance_m: number | null;
  blurred_radius_m: number | null;
  area_m2: number;
  sealed: boolean;
  submitted_at: string;
  /** When it came into effect (never before 18 Nov 2026 20:00 GMT). */
  effective_from: string;
}

export interface WatcherView {
  /** Where nothing is published (shown on the map; movement inside it never is). */
  home_area?: HomeArea | null;
  /** Friendly random label, e.g. "4827". */
  display_code: string | null;
  moving: boolean;
  enabled: boolean;
  status: LiveStatus | "disabled";
  label: string;
  public_lat: number | null;
  public_lng: number | null;
  cell_size_m: number | null;
  observed_at: string | null;
  /** Red/purple alerts on (the server may read this watcher's sealed areas). */
  sealed_alerts: boolean;
  /** The public sample watch link: never saved as a visitor's own. */
  is_sample?: boolean;
  /** "Still there" reminders while I'm in their Want areas (minutes, 0 = off). */
  reminder_minutes: number;
  /** The same for their Locations. */
  reminder_location_minutes: number;
  /** For the alert wording. */
  owner_name?: string;
  owner_first?: string;
  areas: WatcherArea[];
}

export const toWatcherArea = (a: WatchArea): WatcherArea => ({
  reference: a.reference,
  tier: a.tier,
  mode: a.mode,
  kind: a.kind,
  name: a.name,
  note: a.note,
  geojson: a.kind === "beyond_home" ? null : a.geometry,
  shape: a.shape,
  distance_m: a.distance_m,
  blurred_radius_m: a.blurred_radius_m,
  area_m2: Math.round(a.area_m2),
  sealed: a.sealed,
  submitted_at: a.submitted_at,
  effective_from: a.effective_from,
});

/** The latest live GPS reading (private: used only to work out a colour). */
async function latestReading(): Promise<{ lat: number; lng: number; observed_at: string } | null> {
  const { data } = await createServiceClient()
    .from("location_observations")
    .select("observed_at, lat, lng")
    .in("source", ["followmee", "ingest_api"])
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { lat: number; lng: number; observed_at: string } | null) ?? null;
}

/** Everything one watcher may see: their own areas and the colour relative to them. Needs their link. */
export async function watcherView(watcherId: string, token: string): Promise<WatcherView> {
  const supabase = createServiceClient();
  const [enabled, areas, { data: live }, { data: me }, sample, owner, homeArea] = await Promise.all([
    liveMarkerEnabled(),
    loadWatchAreas(watcherId, token),
    supabase.from("live_status").select("*").eq("id", 1).maybeSingle(),
    supabase.from("watchers").select("*").eq("id", watcherId).maybeSingle(),
    import("@/lib/sample-watcher").then((m) => m.loadSampleWatcher()).catch(() => null),
    loadOwnerProfile(),
    loadHomeArea().catch(() => null),
  ]);
  const isSample = sample?.watcherId === watcherId;
  const displayCode = (me?.display_code as string | null | undefined) ?? null;
  const update: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
  // Alerts on but the server secret changed: renew the kept key.
  if (me?.alert_key && !unescrowAreaKey(me.alert_key as string)) update.alert_key = escrowAreaKey(token);
  await supabase.from("watchers").update(update).eq("id", watcherId);
  const sealedAlerts = Boolean(me?.alert_key);

  const publicAreas = areas.map(toWatcherArea);
  if (!enabled) {
    return { display_code: displayCode, moving: false, enabled, status: "disabled", label: LIVE_STATUS_META.disabled.label, public_lat: null, public_lng: null, cell_size_m: null, observed_at: null, sealed_alerts: sealedAlerts, is_sample: isSample, reminder_minutes: Number(me?.reminder_minutes ?? 30), reminder_location_minutes: Number(me?.reminder_location_minutes ?? 30), owner_name: owner.name, owner_first: owner.first, areas: publicAreas, home_area: homeArea };
  }
  const stale = !live?.observed_at || Date.now() - Date.parse(live.observed_at) > liveHoldMs();
  let areaZone: "purple" | "red" | "amber" | null = null;
  if (!stale && areas.length) {
    const p = await latestReading();
    if (p) {
      const z = zoneAt(p, null, zoneAreas(areas));
      areaZone = z === "purple" || z === "red" || z === "amber" ? z : null;
    }
  }
  const homeStatus = ((live?.public_status as LiveStatus | undefined) ?? "unknown") as LiveStatus;
  const status = computeWatcherStatus({ stale, homeStatus, areaZone });
  return {
    display_code: displayCode,
    moving: !stale && Boolean(live?.moving),
    enabled,
    status,
    label: LIVE_STATUS_META[status].label,
    public_lat: live?.public_lat ?? null,
    public_lng: live?.public_lng ?? null,
    cell_size_m: live?.cell_size_m ?? null,
    observed_at: live?.observed_at ?? null,
    sealed_alerts: sealedAlerts,
    is_sample: isSample,
    reminder_minutes: Number(me?.reminder_minutes ?? 30),
    reminder_location_minutes: Number(me?.reminder_location_minutes ?? 30),
    owner_name: owner.name,
    owner_first: owner.first,
    areas: publicAreas,
    home_area: homeArea,
  };
}

let vapid: boolean | null = null;
function vapidReady(): boolean {
  if (vapid !== null) return vapid;
  const pub = optionalEnv("VAPID_PUBLIC_KEY");
  const priv = optionalEnv("VAPID_PRIVATE_KEY");
  const subject = optionalEnv("VAPID_SUBJECT");
  vapid = Boolean(pub && priv && subject);
  if (vapid) setVapidDetails(subject!, pub!, priv!);
  return vapid;
}

/** The owner's name for alert wording (a private setting, not in the code). */
export async function loadOwnerProfile(): Promise<{ name: string; first: string }> {
  const { data } = await createServiceClient().from("system_state").select("value").eq("key", "owner_profile").maybeSingle();
  const v = (data?.value ?? {}) as { name?: string; first?: string };
  return { name: v.name || "the person this site tracks", first: v.first || "They" };
}

/** Push one message to every active device of a watch link. */
async function pushToWatcher(watcherId: string, payload: string) {
  if (!vapidReady()) return;
  const supabase = createServiceClient();
  const { data: subs } = await supabase
    .from("watcher_push_subscriptions")
    .select("id, endpoint, keys, watchers!inner(status)")
    .eq("watcher_id", watcherId)
    .eq("enabled", true)
    .eq("watchers.status", "active");
  for (const s of subs ?? []) {
    try {
      await sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, payload, { TTL: 3600, urgency: "high" });
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await supabase.from("watcher_push_subscriptions").update({ enabled: false }).eq("id", s.id);
    }
  }
}

interface AlertFence {
  id: string;
  reference: string;
  watcher_id: string;
  tier: string | null;
  wide_mode: string | null;
  shape_type: string | null;
  description: string | null;
}

/**
 * Log an alert for the watcher's popup and push it to their devices, in plain
 * words. Sample alerts say loudly that they're from the sample, and carry a
 * "Turn off sample alerts" button.
 */
async function deliverWatcherAlert(opts: {
  fence: AlertFence;
  event: AlertEvent;
  since?: string | null;
  owner: { name: string; first: string };
  sealedNames: Map<string, string>;
  sample: { watcherId: string; token: string } | null;
}) {
  const { fence, event, since, owner, sealedNames, sample } = opts;
  const isSample = sample?.watcherId === fence.watcher_id;
  const outside = fence.tier === "wide" && (fence.wide_mode === "outside" || fence.shape_type === "beyond_home");
  const supabase = createServiceClient();
  await supabase
    .from("watcher_alerts")
    .insert({ watcher_id: fence.watcher_id, event, tier: fence.tier, outside, reference: fence.reference, since: since ?? null });
  // "Still there" reminders count from this alert, so one never follows straight after it.
  if (event === "enter") await supabase.from("geofence_state").update({ last_reminded_at: new Date().toISOString() }).eq("geofence_id", fence.id);
  const areaName = sealedNames.get(fence.id) ?? ((fence.description ?? "").split("\n")[0] || null);
  const { title, body } = alertText({
    ownerName: owner.name,
    ownerFirst: owner.first,
    event,
    tier: fence.tier,
    outside,
    areaName,
    reference: fence.reference,
    since,
    sample: isSample,
  });
  const payload = isSample
    ? { title, body, url: "/sample?alert=1", actions: [{ action: "stop-sample", title: "Turn off sample alerts" }], stopUrl: `/api/watch/${sample!.token}/push` }
    : { title, body, url: "/watch?alert=1" };
  await pushToWatcher(fence.watcher_id, JSON.stringify(payload));
}

async function alertContext() {
  const [owner, sample, sealed] = await Promise.all([
    loadOwnerProfile(),
    import("@/lib/sample-watcher").then((m) => m.loadSampleWatcher()).catch(() => null),
    import("@/lib/watch-areas").then((m) => m.loadAlertSealedAreas()).catch(() => []),
  ]);
  return { owner, sample, sealedNames: new Map(sealed.map((a) => [a.id, a.name])) };
}

/**
 * Tell watchers when I enter or leave one of their areas. The message names
 * their area and the time, never coordinates.
 */
export async function notifyWatchersOfEvents(events: { geofence_id: string; event_type: "enter" | "exit"; observed_at: string }[]) {
  if (!events.length || !(await liveMarkerEnabled())) return;
  const supabase = createServiceClient();
  const { data: fences } = await supabase
    .from("geofences")
    .select("id, reference, watcher_id, tier, wide_mode, shape_type, description")
    .in("id", [...new Set(events.map((e) => e.geofence_id))])
    .not("watcher_id", "is", null);
  if (!fences?.length) return;
  const ctx = await alertContext();
  const byFence = new Map((fences as AlertFence[]).map((f) => [f.id, f]));
  for (const ev of events) {
    const fence = byFence.get(ev.geofence_id);
    if (fence) await deliverWatcherAlert({ ...ctx, fence, event: ev.event_type, since: ev.observed_at });
  }
}

export const REMINDER_CHOICES = [0, 10, 20, 30, 60] as const;

/**
 * "Still there" reminders: while I'm inside a watcher's Want (red) or
 * Location (purple) area, remind that watcher at the interval they chose for
 * that kind (0 = not at all).
 */
export async function sendStillThereReminders(now = Date.now()): Promise<number> {
  if (!(await liveMarkerEnabled())) return 0;
  const supabase = createServiceClient();
  const { data: rows } = await supabase
    .from("geofence_state")
    .select("geofence_id, last_reminded_at, geofences!inner(id, reference, tier, wide_mode, shape_type, description, status, watcher_id)")
    .eq("inside", true)
    .eq("geofences.status", "active")
    .in("geofences.tier", ["local", "location"]);
  type Row = { geofence_id: string; last_reminded_at: string | null; geofences: AlertFence };
  const list = ((rows ?? []) as unknown as Row[]).filter((r) => r.geofences.watcher_id);
  if (!list.length) return 0;
  const watcherIds = [...new Set(list.map((r) => r.geofences.watcher_id))];
  const [{ data: watchers }, { data: enters }] = await Promise.all([
    supabase.from("watchers").select("id, status, reminder_minutes, reminder_location_minutes").in("id", watcherIds),
    supabase.from("geofence_events").select("geofence_id, observed_at").eq("event_type", "enter").in("geofence_id", list.map((r) => r.geofence_id)).order("observed_at", { ascending: false }),
  ]);
  // Separate intervals: Want areas (reminder_minutes) and Locations (reminder_location_minutes).
  const minutesOf = new Map(
    (watchers ?? []).filter((w) => w.status === "active").map((w) => [w.id as string, { local: Number(w.reminder_minutes), location: Number(w.reminder_location_minutes) }]),
  );
  const enteredAt = new Map<string, string>();
  for (const e of enters ?? []) if (!enteredAt.has(e.geofence_id)) enteredAt.set(e.geofence_id, e.observed_at as string);

  let ctx: Awaited<ReturnType<typeof alertContext>> | null = null;
  let sent = 0;
  for (const r of list) {
    const m = minutesOf.get(r.geofences.watcher_id);
    const minutes = m ? (r.geofences.tier === "location" ? m.location : m.local) : 0;
    const since = enteredAt.get(r.geofence_id);
    if (!minutes || !since) continue;
    const last = r.last_reminded_at ? Date.parse(r.last_reminded_at) : Date.parse(since);
    if (now - last < minutes * 60_000 - 30_000) continue; // not due yet (30 s slack for the 3-minute job)
    ctx ??= await alertContext();
    await deliverWatcherAlert({ ...ctx, fence: r.geofences, event: "still", since });
    await supabase.from("geofence_state").update({ last_reminded_at: new Date(now).toISOString() }).eq("geofence_id", r.geofence_id);
    sent++;
  }
  return sent;
}

/** Recent alerts for a watch link (for the popup on their page). */
export async function recentWatcherAlerts(watcherId: string) {
  const { data } = await createServiceClient()
    .from("watcher_alerts")
    .select("id, event, tier, outside, reference, since, created_at")
    .eq("watcher_id", watcherId)
    .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(10);
  return data ?? [];
}
