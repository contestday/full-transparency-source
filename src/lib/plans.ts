import { z } from "zod";
import { snapToGrid, type LatLng } from "@/lib/geo";
import { planEndMs } from "@/lib/plan-outcome";

/** Extensible: add a key here (and optionally to SENSITIVE_CATEGORIES). */
export const PLAN_CATEGORIES = {
  accommodation: "Hotels & accommodation",
  pub: "Pubs",
  restaurant: "Restaurants & cafés",
  healthcare: "Hospitals & healthcare",
  outdoor: "Walks & outdoor",
  event: "Concerts & public events",
  meeting: "Meetings & appointments",
  travel: "Travel",
  other: "Other",
} as const;

export type PlanCategory = keyof typeof PLAN_CATEGORIES;
export const PLAN_CATEGORY_KEYS = Object.keys(PLAN_CATEGORIES) as [PlanCategory, ...PlanCategory[]];

export function categoryLabel(key: string | null | undefined): string {
  if (!key) return "Uncategorised";
  return (PLAN_CATEGORIES as Record<string, string>)[key] ?? key;
}

/**
 * Medical appointments need an extra confirmation before venue precision.
 * (Hotels, travel etc. follow the general venue rule: public venues in full.)
 */
export const SENSITIVE_CATEGORIES: ReadonlySet<string> = new Set(["healthcare"]);

/**
 * Venue privacy rule (owner decision): public venues (pubs, hotels, ...) are
 * shown in full; private addresses, and custom pinned locations, only by area.
 * Returns an error message, or null if the combination is allowed.
 */
export function venuePrecisionError(
  mode: PublicationMode,
  venue: { is_public: boolean } | null,
  hasCustomLocation: boolean,
  confirmPrivateExact: boolean | undefined,
): string | null {
  if (mode !== "exact_venue" && mode !== "retrospective") return null;
  const isPrivate = venue ? !venue.is_public : hasCustomLocation;
  if (isPrivate && !confirmPrivateExact) {
    return "This is a private address: only the area is published unless you explicitly confirm showing it exactly";
  }
  return null;
}

/** Default publication mode for a newly chosen venue. */
export function defaultModeForVenue(venue: { is_public: boolean } | null): PublicationMode {
  return venue?.is_public ? "exact_venue" : "general_area";
}

export const PLAN_STATUSES = ["draft", "planned", "confirmed", "changed", "cancelled", "completed"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PUBLICATION_MODES = ["private", "general_area", "exact_venue", "retrospective"] as const;
export type PublicationMode = (typeof PUBLICATION_MODES)[number];

export const PUBLICATION_MODE_LABELS: Record<PublicationMode, string> = {
  private: "Private (not published)",
  general_area: "General area only",
  exact_venue: "Exact venue",
  retrospective: "Retrospective (shown after it ends)",
};

export const PLAN_GENERAL_AREA_GRID_M = 2000;

const isoDate = z.iso.datetime({ offset: true });

export const planInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(50),
    venue_id: z.uuid().nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    starts_at: isoDate,
    ends_at: isoDate.nullable().optional(),
    all_day: z.boolean().default(true),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    status: z.enum(PLAN_STATUSES).default("draft"),
    publication_mode: z.enum(PUBLICATION_MODES).default("private"),
    public_area_label: z.string().trim().max(120).nullable().optional(),
    /** Must be true to publish a sensitive category at exact_venue precision. */
    confirm_sensitive_exact: z.boolean().optional(),
    /** Must be true to publish a PRIVATE address at venue precision. */
    confirm_private_exact: z.boolean().optional(),
    /** Further locations after the main venue (in order). */
    extra_venue_ids: z.array(z.uuid()).max(9).optional(),
  })
  .refine((p) => !p.ends_at || Date.parse(p.ends_at) >= Date.parse(p.starts_at), {
    message: "End must be after start",
    path: ["ends_at"],
  })
  .refine((p) => (p.lat == null) === (p.lng == null), {
    message: "Latitude and longitude must be provided together",
    path: ["lat"],
  })
  .refine(
    (p) => !(SENSITIVE_CATEGORIES.has(p.category) && p.publication_mode === "exact_venue" && !p.confirm_sensitive_exact),
    {
      message: "Sensitive categories need explicit confirmation to publish the exact venue",
      path: ["publication_mode"],
    },
  );

export const planPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(50),
    venue_id: z.uuid().nullable(),
    description: z.string().trim().max(2000).nullable(),
    starts_at: isoDate,
    ends_at: isoDate.nullable(),
    all_day: z.boolean(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    status: z.enum(PLAN_STATUSES),
    publication_mode: z.enum(PUBLICATION_MODES),
    public_area_label: z.string().trim().max(120).nullable(),
    confirm_sensitive_exact: z.boolean(),
    confirm_private_exact: z.boolean(),
    extra_venue_ids: z.array(z.uuid()).max(9),
  })
  .partial();

export type PlanInput = z.infer<typeof planInputSchema>;

export interface PlanRow {
  id: string;
  title: string;
  category: string;
  venue_id: string | null;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  lat: number | null;
  lng: number | null;
  status: PlanStatus;
  publication_mode: PublicationMode;
  public_area_label: string | null;
  public_lat: number | null;
  public_lng: number | null;
  public_cell_size_m: number | null;
  archived: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /** How a completed plan was confirmed (migration 0010). */
  completion_source?: "gps" | "owner" | null;
  /** When it really happened (GPS or my answer; migration 0010). */
  actual_started_at?: string | null;
  actual_ended_at?: string | null;
}

/**
 * Compute the publicly visible location fields for a plan. Called server-side on
 * every create/update so the public view never sees more than intended.
 */
export function publicLocationFor(
  mode: PublicationMode,
  location: LatLng | null,
): { public_lat: number | null; public_lng: number | null; public_cell_size_m: number | null } {
  if (!location || mode === "private") return { public_lat: null, public_lng: null, public_cell_size_m: null };
  if (mode === "exact_venue" || mode === "retrospective") {
    return { public_lat: location.lat, public_lng: location.lng, public_cell_size_m: null };
  }
  const cell = snapToGrid(location, PLAN_GENERAL_AREA_GRID_M);
  return { public_lat: cell.lat, public_lng: cell.lng, public_cell_size_m: PLAN_GENERAL_AREA_GRID_M };
}

export function isPublished(status: PlanStatus, mode: PublicationMode): boolean {
  return status !== "draft" && mode !== "private";
}

export const STATUS_LABELS: Record<PlanStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  confirmed: "Confirmed",
  changed: "Changed",
  cancelled: "Cancelled",
  completed: "Completed",
};

export interface StopVenue {
  name: string;
  is_public: boolean;
  lat: number | null;
  lng: number | null;
  public_area_label: string | null;
  /** Private location: never named or placed publicly (protects the people there). */
  is_hidden?: boolean;
}

/** Shown to the public in place of a private venue's name. */
export const PRIVATE_LOCATION_LABEL = "Private location";

/**
 * Public fields for one additional plan location, following the venue rule:
 * public venues in full (when the plan shows venues), private addresses by
 * area only, whatever the plan's mode.
 */
export function publicStopFor(mode: PublicationMode, venue: StopVenue) {
  if (venue.is_hidden) return { public_venue_name: null, public_area_label: null, ...publicLocationFor("private", null) };
  const loc = venue.lat != null && venue.lng != null ? { lat: venue.lat, lng: venue.lng } : null;
  const showVenue = (mode === "exact_venue" || mode === "retrospective") && venue.is_public;
  const pos = publicLocationFor(showVenue ? "exact_venue" : mode === "private" ? "private" : "general_area", loc);
  return {
    public_venue_name: showVenue ? venue.name : null,
    public_area_label: venue.public_area_label,
    ...pos,
  };
}

export const RECURRENCE = ["daily", "weekly", "fortnightly", "monthly"] as const;
export type Recurrence = (typeof RECURRENCE)[number];

/** Start times for repeats after the original (the original itself is excluded). */
export function recurrenceStarts(startIso: string, every: Recurrence, count: number): string[] {
  const out: string[] = [];
  const base = new Date(startIso);
  for (let i = 1; i <= count; i++) {
    const d = new Date(base);
    if (every === "daily") d.setUTCDate(d.getUTCDate() + i);
    else if (every === "weekly") d.setUTCDate(d.getUTCDate() + 7 * i);
    else if (every === "fortnightly") d.setUTCDate(d.getUTCDate() + 14 * i);
    else {
      d.setUTCMonth(d.getUTCMonth() + i);
      // Keep the day of month; clamp (e.g. 31 Jan + 1 month → 28/29 Feb)
      if (d.getUTCDate() !== base.getUTCDate()) d.setUTCDate(0);
    }
    out.push(d.toISOString());
  }
  return out;
}

/** Plans are shown a week at a time; "Show more" adds another week. */
export const PLAN_WINDOW_DAYS = 7;

function addDays(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Split plans into those inside a rolling window of days and those beyond it.
 * `dayOf` maps a timestamp to a local (Europe/London) YYYY-MM-DD key.
 *   upcoming: from today up to (not including) today + days; plans already
 *             under way (started earlier, ending today or later) are included.
 *   past:     ended before today, going back `days` days.
 */
export function windowPlans<T extends { starts_at: string; ends_at: string | null; all_day?: boolean }>(
  plans: T[],
  todayKey: string,
  days: number,
  direction: "upcoming" | "past",
  dayOf: (iso: string) => string,
  /** With the current time, a plan moves to "past" as soon as it has finished (not at midnight). */
  nowMs?: number,
): { shown: T[]; beyond: T[]; boundary: string } {
  const finished = (p: T) =>
    nowMs != null ? planEndMs({ starts_at: p.starts_at, ends_at: p.ends_at, all_day: Boolean(p.all_day) }) < nowMs : dayOf(p.ends_at ?? p.starts_at) < todayKey;
  if (direction === "upcoming") {
    const end = addDays(todayKey, days);
    const relevant = plans.filter((p) => !finished(p));
    return {
      shown: relevant.filter((p) => dayOf(p.starts_at) < end),
      beyond: relevant.filter((p) => dayOf(p.starts_at) >= end),
      boundary: end,
    };
  }
  const start = addDays(todayKey, -days);
  const relevant = plans.filter(finished);
  return {
    shown: relevant.filter((p) => dayOf(p.ends_at ?? p.starts_at) >= start),
    beyond: relevant.filter((p) => dayOf(p.ends_at ?? p.starts_at) < start),
    boundary: start,
  };
}

/**
 * Order for a plans list. Upcoming: in time order (date, then time: 10 am
 * before 8:30 pm). Past: latest day first, latest time first within it. Pure.
 */
export function planListOrder<T extends { starts_at: string }>(items: readonly T[], dayOf: (iso: string) => string, direction: "upcoming" | "past"): T[] {
  return direction === "upcoming"
    ? [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    : latestFirstWithinDay(items, dayOf, "descending");
}

/**
 * Order for any day-by-day list: days in the given direction, and within each
 * day the latest time first (11 pm above 11 am). Pure.
 */
export function latestFirstWithinDay<T extends { starts_at: string }>(
  items: readonly T[],
  dayOf: (iso: string) => string,
  days: "ascending" | "descending",
): T[] {
  return [...items].sort((a, b) => {
    const da = dayOf(a.starts_at);
    const db = dayOf(b.starts_at);
    if (da !== db) return days === "ascending" ? da.localeCompare(db) : db.localeCompare(da);
    return b.starts_at.localeCompare(a.starts_at);
  });
}
