// Events: a watcher marks an event (a concert, a few days in a town) as
// somewhere they'd rather I wasn't, for that time only. Pure; shared by
// server and browser. Owner decisions, 21 Nov 2026:
//   * Set at least 48 hours ahead (never on the day or after), up to 5 years ahead.
//   * Any length. Counts only between its start and end, then it's on the record as ended.
//   * Places: a venue with a radius (up to 5 miles), or a named town or city.
//   * Levels: Wish, Want, Demand. None is a legal order.
//   * Shown in black, to me and to the watcher who set it. Never public.
//   * An event that includes my home: I'm never expected to leave home for it,
//     and time at home never counts.

import { pointInArea, signedDistanceM, type AreaGeometry } from "@/lib/geofence/area-geometry";
import type { LatLng } from "@/lib/geo";

export type EventLevel = "wish" | "want" | "demand";
export const EVENT_LEVELS: EventLevel[] = ["wish", "want", "demand"];

export const EVENT_COLOR = "#111111";

export const EVENT_LEVEL_META: Record<EventLevel, { label: string; description: string }> = {
  wish: { label: "Wish", description: "You'd rather I didn't go." },
  want: { label: "Want", description: "You're asking me not to go." },
  demand: { label: "Demand", description: "You're firmly telling me not to go. Still not a legal order." },
};

const HOUR = 3_600_000;
const MILE_M = 1609.344;

export const EVENT_RULES = {
  minNoticeMs: 48 * HOUR,
  maxAheadMs: Math.round(5 * 365.25 * 24 * HOUR),
  maxPlaces: 10,
  venueMinRadiusM: 25,
  venueMaxRadiusM: Math.round(5 * MILE_M),
  /** A named town or city: up to about 250 square miles (a big city, not a county). */
  placeMaxAreaM2: 250 * MILE_M * MILE_M,
  /** Leaving a place: this far outside its edge, so GPS jitter can't flicker it. */
  exitMarginM: 30,
} as const;

/** Radius choices for a venue. */
export const VENUE_RADII = [
  { label: "Just the venue (100 m)", m: 100 },
  { label: "250 m", m: 250 },
  { label: "500 m", m: 500 },
  { label: "1 km", m: 1000 },
  { label: "1 mile", m: Math.round(MILE_M) },
  { label: "2 miles", m: Math.round(2 * MILE_M) },
  { label: "5 miles", m: Math.round(5 * MILE_M) },
];

export class EventRuleError extends Error {}

/** Check an event's times. Throws EventRuleError with a message for the watcher. */
export function checkEventWindow(startsAt: number, endsAt: number, now = Date.now()): void {
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) throw new EventRuleError("Choose when the event starts and ends.");
  if (endsAt <= startsAt) throw new EventRuleError("The event must end after it starts.");
  if (startsAt < now + EVENT_RULES.minNoticeMs) {
    throw new EventRuleError("An event must be set at least 48 hours before it starts, so there's time to change plans.");
  }
  if (startsAt > now + EVENT_RULES.maxAheadMs) throw new EventRuleError("An event can be set up to 5 years ahead.");
}

export type EventPhase = "upcoming" | "on" | "ended" | "cancelled";

export function eventPhase(e: { status: string; starts_at: string; ends_at: string; recurrence?: Recurrence | null }, now = Date.now()): EventPhase {
  if (e.status === "cancelled") return "cancelled";
  if (now >= Date.parse(e.ends_at)) return "ended";
  // Repeating events between their times are "upcoming" (the next one).
  return eventOnAt(e, now) ? "on" : "upcoming";
}

export const PHASE_LABEL: Record<EventPhase, string> = { upcoming: "Upcoming", on: "On now", ended: "Ended", cancelled: "Cancelled" };

/** Does any place include the point (e.g. home)? */
export function placesInclude(places: { geojson: AreaGeometry }[], p: LatLng): boolean {
  return places.some((pl) => pointInArea(p, pl.geojson));
}

/**
 * Inside a place, with a margin on the way out so GPS jitter can't flicker it.
 * At home never counts.
 */
export function insidePlace(p: LatLng, g: AreaGeometry, wasInside: boolean, atHome: boolean): boolean {
  if (atHome) return false;
  const d = signedDistanceM(p, g);
  return wasInside ? d > -EVENT_RULES.exitMarginM : d > 0;
}

/** The standing assurance shown on any event (or area) that includes my home. */
export function homeAssurance(first: string): string {
  return `This includes ${first}'s home. ${first} isn't expected to leave home while it's on, and won't leave home into it. Time at home never counts.`;
}

export const EVENTS_NOTE =
  "Your events, like Wish and Want, express wishes, not legal orders. They're shown only to me and to you, never on public pages. Events I'm banned from are different: they're public, for everyone to see.";

// ------------------------------------------------------------ repeating events
// Outlook-style repeats (UK dates and times):
//   daily    every N days
//   weekly   every N weeks, on chosen days
//   monthly  every N months, on day D (or the month's last day if shorter), or
//            on the first / second / third / fourth / last weekday
//   yearly   every N years, on a date, or on the nth weekday of a month
// Ending on a date, after a number of times, or never.

export type RepeatFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface Recurrence {
  freq: RepeatFreq;
  /** Every N days / weeks / months / years (default 1). */
  interval?: number;
  /** Weekly: 0 = Sunday … 6 = Saturday. */
  days?: number[];
  /** Monthly / yearly: a day of the month, or the nth weekday. */
  by?: "day" | "nth";
  day?: number;
  /** 1–4, or -1 for the last. */
  nth?: number;
  weekday?: number;
  /** Yearly: 1–12. */
  month?: number;
  /** "18:00" (UK time). */
  start_time: string;
  /** "22:00"; earlier than start_time means it runs past midnight. */
  end_time: string;
  /** The first date the pattern counts from (UK date). */
  anchor?: string;
  /** Ends after this many times (for the wording). */
  count?: number | null;
  /** Ends on this date (for the wording). */
  until?: string | null;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const NTH_LABEL: Record<number, string> = { 1: "first", 2: "second", 3: "third", 4: "fourth", [-1]: "last" };
const WD_SHORT: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** "No end date": the series window runs to here. */
export const OPEN_END_DATE = "2100-01-01";

const londonFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

/** UK local date and time of an instant. */
export function londonParts(ms: number): { date: string; minutes: number; weekday: number } {
  const p = Object.fromEntries(londonFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: WD_SHORT[p.weekday] };
}

export const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** A UK local date and time ("2026-12-05", "18:00") as an instant. */
export function londonToUtc(date: string, time: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = londonParts(t);
    const [py, pm, pd] = p.date.split("-").map(Number);
    const asUtc = Date.UTC(py, pm - 1, pd, Math.floor(p.minutes / 60), p.minutes % 60);
    t = guess - (asUtc - t);
  }
  return t;
}

/** Plain date arithmetic on "YYYY-MM-DD". */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const dayNum = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};
export const weekdayOf = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const overnight = (r: Recurrence) => toMinutes(r.end_time) <= toMinutes(r.start_time);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Does a date match the day-of-month rule (a day, or the nth weekday)? */
function matchesMonthDay(r: Recurrence, y: number, m: number, d: number, wd: number): boolean {
  if (r.by === "nth") {
    if (wd !== r.weekday) return false;
    if (r.nth === -1) return d + 7 > daysInMonth(y, m);
    return Math.ceil(d / 7) === r.nth;
  }
  return d === Math.min(r.day ?? 1, daysInMonth(y, m));
}

/** Is this UK date one of the pattern's days, counting from `anchor`? */
export function isOccurrenceDate(r: Recurrence, date: string, anchor: string): boolean {
  if (date < anchor) return false;
  const n = Math.max(1, r.interval ?? 1);
  const [y, m, d] = date.split("-").map(Number);
  const [ay, am] = anchor.split("-").map(Number);
  const wd = weekdayOf(date);
  switch (r.freq) {
    case "daily":
      return mod(dayNum(date) - dayNum(anchor), n) === 0;
    case "weekly": {
      if (!(r.days ?? []).includes(wd)) return false;
      const monday = (x: string) => dayNum(x) - mod(weekdayOf(x) - 1, 7);
      return mod((monday(date) - monday(anchor)) / 7, n) === 0;
    }
    case "monthly":
      return mod((y - ay) * 12 + (m - am), n) === 0 && matchesMonthDay(r, y, m, d, wd);
    case "yearly":
      return mod(y - ay, n) === 0 && m === r.month && matchesMonthDay(r, y, m, d, wd);
  }
}

export function checkRecurrence(r: Recurrence): void {
  const n = r.interval ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new EventRuleError("Repeat every 1 to 99.");
  if (r.freq === "weekly" && !(r.days ?? []).length) throw new EventRuleError("Choose at least one day of the week.");
  if (r.freq === "monthly" || r.freq === "yearly") {
    if (r.by === "nth") {
      if (![1, 2, 3, 4, -1].includes(r.nth ?? 0) || r.weekday == null || r.weekday < 0 || r.weekday > 6) {
        throw new EventRuleError("Choose which weekday of the month.");
      }
    } else if (!r.day || r.day < 1 || r.day > 31) throw new EventRuleError("Choose a day of the month (1 to 31).");
  }
  if (r.freq === "yearly" && (!r.month || r.month < 1 || r.month > 12)) throw new EventRuleError("Choose a month.");
  if (!/^\d{2}:\d{2}$/.test(r.start_time) || !/^\d{2}:\d{2}$/.test(r.end_time)) throw new EventRuleError("Choose the start and end times.");
  if (r.start_time === r.end_time) throw new EventRuleError("The end time must differ from the start time.");
}

/** Most days searched for a first time (just over 10 years). */
const SEARCH_DAYS = 3700;

/**
 * The whole series, from the first time on or after `firstDate` to the last
 * time: on or before `until`, after `count` times, or never (open). Null if
 * no day matches.
 */
export function seriesWindow(
  r: Recurrence,
  firstDate: string,
  end: { until?: string | null; count?: number | null } | string,
): { startsAt: number; endsAt: number; firstDate: string; lastDate: string | null } | null {
  const e = typeof end === "string" ? { until: end } : end;
  let first: string | null = null;
  for (let d = firstDate, i = 0; i < SEARCH_DAYS; d = addDays(d, 1), i++) {
    if (e.until && d > e.until) break;
    if (isOccurrenceDate(r, d, firstDate)) {
      first = d;
      break;
    }
  }
  if (!first) return null;
  let last: string | null = null;
  if (e.count) {
    let seen = 0;
    for (let d = first, i = 0; i < SEARCH_DAYS * 10; d = addDays(d, 1), i++) {
      if (isOccurrenceDate(r, d, firstDate) && ++seen === e.count) {
        last = d;
        break;
      }
    }
    if (!last) return null;
  } else if (e.until) {
    for (let d = e.until, i = 0; d >= first && i < SEARCH_DAYS * 10; d = addDays(d, -1), i++) {
      if (isOccurrenceDate(r, d, firstDate)) {
        last = d;
        break;
      }
    }
  }
  const startsAt = londonToUtc(first, r.start_time);
  const endsAt = last ? londonToUtc(overnight(r) ? addDays(last, 1) : last, r.end_time) : londonToUtc(OPEN_END_DATE, "00:00");
  return { startsAt, endsAt, firstDate: first, lastDate: last };
}

const anchorOf = (e: { starts_at: string; recurrence?: Recurrence | null }) => e.recurrence?.anchor ?? londonParts(Date.parse(e.starts_at)).date;

/** Is the event on at this moment (inside its window, and for repeating events, inside one of its times)? */
export function eventOnAt(e: { status?: string; starts_at: string; ends_at: string; recurrence?: Recurrence | null }, ms: number): boolean {
  if (e.status === "cancelled") return false;
  if (ms < Date.parse(e.starts_at) || ms >= Date.parse(e.ends_at)) return false;
  const r = e.recurrence;
  if (!r) return true;
  const anchor = anchorOf(e);
  const p = londonParts(ms);
  const s = toMinutes(r.start_time);
  const en = toMinutes(r.end_time);
  if (!overnight(r)) return p.minutes >= s && p.minutes < en && isOccurrenceDate(r, p.date, anchor);
  return (p.minutes >= s && isOccurrenceDate(r, p.date, anchor)) || (p.minutes < en && isOccurrenceDate(r, addDays(p.date, -1), anchor));
}

/** Which UK dates an event touches between two dates (for a calendar). */
export function eventDates(e: { starts_at: string; ends_at: string; recurrence?: Recurrence | null }, from: string, to: string): string[] {
  const first = londonParts(Date.parse(e.starts_at)).date;
  const last = londonParts(Date.parse(e.ends_at) - 1).date;
  const out: string[] = [];
  const start = from > first ? from : first;
  const end = to < last ? to : last;
  const anchor = anchorOf(e);
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!e.recurrence || isOccurrenceDate(e.recurrence, d, anchor)) out.push(d);
  }
  return out;
}

const plural = (n: number, word: string) => (n === 1 ? word : `${n} ${word}s`);
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const fmtUkDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
};

/** "Every 4 weeks on Thursday, 18:00 to 22:00, until 31 December 2027". */
export function describeRecurrence(r: Recurrence, opts: { times?: boolean; end?: boolean } = {}): string {
  const n = Math.max(1, r.interval ?? 1);
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.freq];
  let text = `Every ${plural(n, unit)}`;
  if (r.freq === "weekly") {
    const days = [...(r.days ?? [])].sort((a, b) => mod(a - 1, 7) - mod(b - 1, 7)).map((d) => WEEKDAYS[d]);
    const list = days.length === 7 ? "every day" : days.length === 1 ? days[0] : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
    text = n === 1 && days.length < 7 ? `Every ${list}` : `${text} on ${list}`;
  } else if (r.freq === "monthly") {
    text += r.by === "nth" ? ` on the ${NTH_LABEL[r.nth ?? 1]} ${WEEKDAYS[r.weekday ?? 1]}` : ` on the ${ordinal(r.day ?? 1)}`;
  } else if (r.freq === "yearly") {
    const month = MONTHS[(r.month ?? 1) - 1];
    text += r.by === "nth" ? ` on the ${NTH_LABEL[r.nth ?? 1]} ${WEEKDAYS[r.weekday ?? 1]} of ${month}` : ` on ${r.day ?? 1} ${month}`;
  }
  if (opts.times !== false) text += `, ${r.start_time} to ${r.end_time}${overnight(r) ? " (next day)" : ""}`;
  if (opts.end) text += r.count ? `, ${r.count} time${r.count === 1 ? "" : "s"}` : r.until ? `, until ${fmtUkDate(r.until)}` : ", no end date";
  return text;
}
