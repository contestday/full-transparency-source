import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/http";
import { isPublished, publicLocationFor, publicStopFor, venuePrecisionError, type PlanInput, type PlanRow, type StopVenue } from "@/lib/plans";

/** Resolve the plan's private location (venue first, then explicit lat/lng). */
async function resolveLocation(supabase: SupabaseClient, input: Pick<PlanInput, "venue_id" | "lat" | "lng">) {
  if (input.venue_id) {
    const { data: venue, error } = await supabase
      .from("venues")
      .select("lat, lng, public_area_label, is_public")
      .eq("id", input.venue_id)
      .maybeSingle();
    if (error) throw error;
    if (!venue) throw new HttpError(422, "Venue not found");
    if (venue.lat != null && venue.lng != null) {
      return { location: { lat: venue.lat, lng: venue.lng }, venueAreaLabel: venue.public_area_label as string | null, venue };
    }
    return { location: null, venueAreaLabel: venue.public_area_label as string | null, venue };
  }
  if (input.lat != null && input.lng != null) return { location: { lat: input.lat, lng: input.lng }, venueAreaLabel: null, venue: null };
  return { location: null, venueAreaLabel: null, venue: null };
}

/**
 * Build the DB row for a plan, computing publication fields server-side.
 * `existing` is supplied on update so published_at is preserved.
 */
export async function buildPlanRow(supabase: SupabaseClient, input: PlanInput, existing?: PlanRow | null) {
  const { location, venueAreaLabel, venue } = await resolveLocation(supabase, input);
  const privacyError = venuePrecisionError(
    input.publication_mode,
    venue ? { is_public: Boolean(venue.is_public) } : null,
    input.lat != null,
    input.confirm_private_exact,
  );
  if (privacyError) throw new HttpError(422, privacyError);
  const pub = publicLocationFor(input.publication_mode, location);
  const published = isPublished(input.status, input.publication_mode);
  return {
    title: input.title,
    category: input.category,
    venue_id: input.venue_id ?? null,
    description: input.description ?? null,
    starts_at: input.starts_at,
    ends_at: input.ends_at ?? null,
    all_day: input.all_day,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    status: input.status,
    publication_mode: input.publication_mode,
    public_area_label: input.public_area_label || venueAreaLabel || null,
    ...pub,
    published_at: published ? (existing?.published_at ?? new Date().toISOString()) : null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Replace a plan's additional locations (or, with `venueIds` undefined,
 * recompute the public fields of the existing ones, e.g. after a mode change).
 */
export async function syncPlanLocations(
  supabase: SupabaseClient,
  planId: string,
  mode: PlanInput["publication_mode"],
  venueIds?: string[],
) {
  let ids = venueIds;
  if (!ids) {
    const { data } = await supabase.from("plan_locations").select("venue_id").eq("plan_id", planId).order("position");
    ids = (data ?? []).map((r) => r.venue_id as string);
  }
  const { error: delErr } = await supabase.from("plan_locations").delete().eq("plan_id", planId);
  if (delErr) throw delErr;
  if (!ids.length) return;
  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name, is_public, lat, lng, public_area_label")
    .in("id", ids);
  if (error) throw error;
  const byId = new Map((venues ?? []).map((v) => [v.id as string, v]));
  const rows = ids.flatMap((id, i) => {
    const v = byId.get(id);
    if (!v) return [];
    return [{ plan_id: planId, position: i + 1, venue_id: id, ...publicStopFor(mode, v as StopVenue) }];
  });
  if (rows.length) {
    const { error: insErr } = await supabase.from("plan_locations").insert(rows);
    if (insErr) throw insErr;
  }
}
