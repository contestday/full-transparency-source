import { londonDayKey } from "@/lib/format";

const DAY = 86_400_000;
export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const shiftDay = (dayKey: string, n: number) => new Date(Date.parse(`${dayKey}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** "All time" starts here (before any record). */
export const ALL_TIME_FROM = "2000-01-01";
/** Routes are drawn for ranges up to this many days; longer ranges show the stays only. */
export const ROUTE_MAX_DAYS = 21;

export const rangeDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
/** Whether a range is short enough to draw the routes. */
export const routesShown = (from: string, to: string) => rangeDays(from, to) <= ROUTE_MAX_DAYS;

export type QuickRange = { key: string; label: string; from: string; to: string };

/** Quick ranges in London time: Today, Yesterday, This week (Mon–today), This month, This year, All time. */
export function quickRanges(today: string): QuickRange[] {
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return [
    { key: "today", label: "Today", from: today, to: today },
    { key: "yesterday", label: "Yesterday", from: shiftDay(today, -1), to: shiftDay(today, -1) },
    { key: "week", label: "This week", from: shiftDay(today, -weekday), to: today },
    { key: "month", label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
    { key: "year", label: "This year", from: `${today.slice(0, 4)}-01-01`, to: today },
    { key: "all", label: "All time", from: ALL_TIME_FROM, to: today },
  ];
}

/** The requested range (default: today). */
export function historyRange(sp: { from?: unknown; to?: unknown }) {
  const today = londonDayKey(new Date().toISOString());
  const to = isDate(sp.to) ? sp.to : today;
  let from = isDate(sp.from) ? sp.from : to;
  if (from > to) from = to;
  if (from < ALL_TIME_FROM) from = ALL_TIME_FROM;
  return { today, from, to };
}
