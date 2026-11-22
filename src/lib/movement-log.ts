import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { haversineMeters } from "@/lib/geo";
import { loadHome } from "@/lib/home";

/**
 * The full movement record for an evidence report (owner's decision, 22 Nov
 * 2026): every stay, every journey and every GPS reading in the dates, home
 * area included, so nothing is silently left out. The one exception is
 * private locations (other people's homes): the times are kept, but the place
 * is never named or positioned, and readings near it lose their position.
 */
export const PRIVATE_PLACE_LABEL = "Private location – address available to police on request";
/** Readings this close to a private location lose their position. */
const PRIVATE_RADIUS_M = 250;
/** An unnamed stay this close to home is labelled Home. */
const HOME_RADIUS_M = 150;
export const MOVEMENT_MAX_DAYS = 184;
export const MOVEMENT_MAX_POINTS = 120_000;

export interface MovementStay {
  from: string;
  until: string;
  place: string;
  lat: number | null;
  lng: number | null;
  private: boolean;
}

export interface MovementJourney {
  from: string;
  until: string;
  fromPlace: string;
  toPlace: string;
  distance_m: number;
  readings: number;
}

/** [time, lat, lng, accuracy]; lat/lng null near a private location. */
export type MovementPoint = [string, number | null, number | null, number | null];

export interface MovementLog {
  from: string;
  to: string;
  stays: MovementStay[];
  journeys: MovementJourney[];
  points: MovementPoint[];
  truncated: boolean;
}

const round = (n: number) => Math.round(n * 100_000) / 100_000;

type VisitRow = { started_at: string; ended_at: string; lat: number; lng: number; venue_id: string | null };
type VenueRow = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; is_hidden: boolean | null };
type ObsRow = { observed_at: string; lat: number; lng: number; accuracy_m: number | null };

export async function loadMovementLog(fromIso: string, toIso: string): Promise<MovementLog> {
  const db = createServiceClient();
  const [visitsRes, hiddenRes, home] = await Promise.all([
    db.from("visits").select("started_at, ended_at, lat, lng, venue_id").lte("started_at", toIso).gte("ended_at", fromIso).order("started_at").limit(5000),
    db.from("venues").select("id, name, address, lat, lng, is_hidden").eq("is_hidden", true),
    loadHome().catch(() => null),
  ]);
  if (visitsRes.error) throw visitsRes.error;
  const visits = (visitsRes.data ?? []) as VisitRow[];
  const hidden = ((hiddenRes.data ?? []) as VenueRow[]).filter((v) => v.lat != null && v.lng != null);
  const venueIds = [...new Set(visits.map((v) => v.venue_id).filter((x): x is string => Boolean(x)))];
  const { data: venueRows } = venueIds.length ? await db.from("venues").select("id, name, address, lat, lng, is_hidden").in("id", venueIds) : { data: [] };
  const venues = new Map(((venueRows ?? []) as VenueRow[]).map((v) => [v.id, v]));

  const nearPrivate = (lat: number, lng: number) => hidden.some((h) => haversineMeters({ lat, lng }, { lat: h.lat!, lng: h.lng! }) <= PRIVATE_RADIUS_M);

  const stays: MovementStay[] = visits.map((v) => {
    const venue = v.venue_id ? venues.get(v.venue_id) : undefined;
    const isPrivate = Boolean(venue?.is_hidden) || nearPrivate(v.lat, v.lng);
    if (isPrivate) return { from: v.started_at, until: v.ended_at, place: PRIVATE_PLACE_LABEL, lat: null, lng: null, private: true };
    const atHome = !venue && home && haversineMeters({ lat: v.lat, lng: v.lng }, home) <= HOME_RADIUS_M;
    const name = venue ? [venue.name, venue.address].filter(Boolean).join(", ") : atHome ? "Home" : "Unnamed place";
    return { from: v.started_at, until: v.ended_at, place: name, lat: round(v.lat), lng: round(v.lng), private: false };
  });

  // Every reading in the dates (Supabase returns at most 1,000 rows a request).
  const points: MovementPoint[] = [];
  const raw: ObsRow[] = [];
  let truncated = false;
  for (let row = 0; ; row += 1000) {
    if (row >= MOVEMENT_MAX_POINTS) {
      truncated = true;
      break;
    }
    const { data, error } = await db
      .from("location_observations")
      .select("observed_at, lat, lng, accuracy_m")
      .gte("observed_at", fromIso)
      .lte("observed_at", toIso)
      .neq("validation_status", "rejected")
      .order("observed_at")
      .order("id")
      .range(row, row + 999);
    if (error) throw error;
    raw.push(...((data ?? []) as ObsRow[]));
    if (!data || data.length < 1000) break;
  }
  for (const o of raw) {
    const acc = o.accuracy_m == null ? null : Math.round(Number(o.accuracy_m));
    points.push(nearPrivate(o.lat, o.lng) ? [o.observed_at, null, null, acc] : [o.observed_at, round(o.lat), round(o.lng), acc]);
  }

  // Journeys: the movement between one stay and the next.
  const journeys: MovementJourney[] = [];
  let p = 0;
  for (let i = 0; i < stays.length - 1; i++) {
    const a = stays[i];
    const b = stays[i + 1];
    if (b.from <= a.until) continue;
    while (p < raw.length && raw[p].observed_at < a.until) p++;
    let q = p;
    let dist = 0;
    for (; q < raw.length && raw[q].observed_at <= b.from; q++) {
      if (q > p) dist += haversineMeters(raw[q - 1], raw[q]);
    }
    journeys.push({ from: a.until, until: b.from, fromPlace: a.place, toPlace: b.place, distance_m: Math.round(dist), readings: q - p });
    p = q;
  }
  return { from: fromIso, to: toIso, stays, journeys, points, truncated };
}
