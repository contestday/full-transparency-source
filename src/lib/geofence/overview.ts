import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * For the top of admin Geofences: how many areas and events are in place, by
 * colour (mine and others counted apart), and a log of when each was added or
 * removed and of what type. Only the type, reference and time: never where.
 */
export type OverviewColour = "red" | "amber" | "purple" | "black";

export interface OverviewRow {
  colour: OverviewColour;
  hex: string;
  label: string;
  mine: number | null;
  mineNote?: string;
  others: number | null;
  othersNote?: string;
}

export interface ActivityItem {
  id: string;
  at: string;
  verb: "Added" | "Changed" | "Removed" | "Cancelled";
  type: string;
  colour: OverviewColour;
  who: "Me" | "Me (sample)" | "A watcher" | "Someone";
  reference: string | null;
  isPrivate: boolean;
}

const HEX: Record<OverviewColour, string> = { red: "#C62828", amber: "#F08C00", purple: "#7E22CE", black: "#111111" };

const ACTIONS: Record<string, ActivityItem["verb"]> = {
  "geofence.submitted": "Added",
  "geofence.created": "Added",
  "geofence.replaced_by_watcher": "Changed",
  "geofence.withdrawn_by_watcher": "Removed",
  "geofence.withdrawn_by_submitter": "Removed",
  "geofence.withdrawn": "Removed",
  "geofence.changed": "Changed",
  "geofence.archived": "Removed",
  "geofence.deleted": "Removed",
  "watch_event.set": "Added",
  "watch_event.owner_set": "Added",
  "watch_event.cancelled": "Cancelled",
  "watch_event.owner_cancelled": "Cancelled",
};

type Fence = { id: string; reference: string; tier: string | null; origin: string; status: string; watcher_id: string | null };
type Ev = { id: string; reference: string; level: string; is_owner: boolean; status: string; ends_at: string };

const FENCE_COLS = "id, reference, tier, origin, status, watcher_id";

/** Watch links that are mine: the public sample, plus any I've marked as mine (system_state "owner_watchers"). */
async function loadMyWatcherIds(db: ReturnType<typeof createServiceClient>): Promise<{ sample: string | null; own: Set<string> }> {
  const { data } = await db.from("system_state").select("key, value").in("key", ["sample_watcher", "owner_watchers"]);
  let sample: string | null = null;
  const own = new Set<string>();
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    if (row.key === "sample_watcher") sample = (row.value as { watcherId?: string } | null)?.watcherId ?? null;
    if (row.key === "owner_watchers") for (const id of ((row.value as { ids?: string[] } | null)?.ids ?? [])) own.add(id);
  }
  if (sample) own.add(sample);
  return { sample, own };
}

function fenceType(f: Fence | undefined, mine: Set<string>): { type: string; colour: OverviewColour; mine: boolean; isPrivate: boolean } {
  if (!f) return { type: "Area (since deleted)", colour: "red", mine: false, isPrivate: false };
  if (f.origin === "admin") return { type: "My area", colour: "red", mine: true, isPrivate: false };
  const own = Boolean(f.watcher_id && mine.has(f.watcher_id));
  if (f.tier === "wide") return { type: "Wish", colour: "amber", mine: own, isPrivate: false };
  if (f.tier === "local") return { type: "Want", colour: "red", mine: own, isPrivate: false };
  return { type: "Location (private)", colour: "purple", mine: own, isPrivate: true };
}

const LEVEL: Record<string, string> = { wish: "Wish", want: "Want", demand: "Demand" };

function eventType(e: Ev | undefined): { type: string; colour: OverviewColour; mine: boolean } {
  if (!e) return { type: "Event", colour: "black", mine: false };
  if (e.is_owner) return { type: "Event I'm banned from", colour: "red", mine: true };
  return { type: `Event (${LEVEL[e.level] ?? e.level})`, colour: "black", mine: false };
}

export async function loadGeofenceOverview(days = 30): Promise<{ rows: OverviewRow[]; activity: ActivityItem[] }> {
  const db = createServiceClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const nowIso = new Date().toISOString();
  const [fencesRes, eventsRes, auditRes, mineIds] = await Promise.all([
    db.from("geofences").select(FENCE_COLS).eq("status", "active").limit(5000),
    db.from("watch_events").select("id, reference, level, is_owner, status, ends_at").neq("status", "cancelled").gt("ends_at", nowIso).limit(5000),
    db
      .from("audit_events")
      .select("id, action, actor_id, resource_id, created_at")
      .in("action", Object.keys(ACTIONS))
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100),
    loadMyWatcherIds(db),
  ]);
  const fences = (fencesRes.data ?? []) as Fence[];
  const events = eventsRes.error ? [] : ((eventsRes.data ?? []) as Ev[]);
  const isMine = (f: Fence) => f.origin === "admin" || Boolean(f.watcher_id && mineIds.own.has(f.watcher_id));
  const split = (pred: (f: Fence) => boolean) => {
    const all = fences.filter((f) => f.origin !== "admin" && pred(f));
    return { mine: all.filter(isMine).length, others: all.filter((f) => !isMine(f)).length };
  };
  const wish = split((f) => f.tier === "wide");
  const want = split((f) => f.tier === "local");
  const loc = split((f) => f.tier === "location");
  const myAreas = fences.filter((f) => f.origin === "admin").length;
  const rows: OverviewRow[] = [
    { colour: "red", hex: HEX.red, label: "My areas", mine: myAreas, mineNote: "Shown to everyone", others: null },
    { colour: "red", hex: HEX.red, label: "Want", mine: want.mine, others: want.others },
    { colour: "amber", hex: HEX.amber, label: "Wish", mine: wish.mine, others: wish.others },
    { colour: "purple", hex: HEX.purple, label: "Location", mine: loc.mine, others: loc.others, othersNote: "Private" },
    {
      colour: "black",
      hex: HEX.black,
      label: "Events",
      mine: events.filter((e) => e.is_owner).length,
      mineNote: "Bans, red to everyone",
      others: events.filter((e) => !e.is_owner).length,
      othersNote: "On now or coming up",
    },
  ];

  // The log: look up each item's type (including removed ones).
  const audit = (auditRes.data ?? []) as { id: string; action: string; actor_id: string | null; resource_id: string | null; created_at: string }[];
  const fenceIds = [...new Set(audit.filter((a) => a.action.startsWith("geofence.") && a.resource_id).map((a) => a.resource_id!))];
  const eventIds = [...new Set(audit.filter((a) => a.action.startsWith("watch_event.") && a.resource_id).map((a) => a.resource_id!))];
  const [fRes, eRes] = await Promise.all([
    fenceIds.length ? db.from("geofences").select(FENCE_COLS).in("id", fenceIds) : Promise.resolve({ data: [] }),
    eventIds.length ? db.from("watch_events").select("id, reference, level, is_owner, status, ends_at").in("id", eventIds) : Promise.resolve({ data: [] }),
  ]);
  const fById = new Map(((fRes.data ?? []) as Fence[]).map((f) => [f.id, f]));
  const eById = new Map(((eRes.data ?? []) as Ev[]).map((e) => [e.id, e]));

  const activity: ActivityItem[] = audit.map((a) => {
    const verb = ACTIONS[a.action];
    if (a.action.startsWith("geofence.")) {
      const f = a.resource_id ? fById.get(a.resource_id) : undefined;
      const t = fenceType(f, mineIds.own);
      return {
        id: a.id,
        at: a.created_at,
        verb,
        type: t.type,
        colour: t.colour,
        who: t.mine || a.actor_id ? (f?.watcher_id && f.watcher_id === mineIds.sample ? "Me (sample)" : "Me") : f ? "A watcher" : "Someone",
        reference: f?.reference ?? null,
        isPrivate: t.isPrivate,
      };
    }
    const e = a.resource_id ? eById.get(a.resource_id) : undefined;
    const t = eventType(e);
    return {
      id: a.id,
      at: a.created_at,
      verb,
      type: t.type,
      colour: t.colour,
      who: t.mine || a.action.includes("owner") ? "Me" : "A watcher",
      reference: e?.reference ?? null,
      isPrivate: false,
    };
  });
  return { rows, activity };
}

export const OVERVIEW_HEX = HEX;
