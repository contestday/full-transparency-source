import { londonDayKey } from "@/lib/format";

const DAY = 86_400_000;
export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const shiftDay = (dayKey: string, n: number) => new Date(Date.parse(`${dayKey}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Quick ranges in London time: Today, Yesterday, Last 3 days, This week (Mon–today). */
export function quickRanges(today: string) {
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: shiftDay(today, -1), to: shiftDay(today, -1) },
    { label: "Last 3 days", from: shiftDay(today, -2), to: today },
    { label: "This week", from: shiftDay(today, -weekday), to: today },
  ];
}

/** The requested range (default: the last 3 days), kept to about three weeks. */
export function historyRange(sp: { from?: unknown; to?: unknown }) {
  const today = londonDayKey(new Date().toISOString());
  const to = isDate(sp.to) ? sp.to : today;
  let from = isDate(sp.from) ? sp.from : shiftDay(to, -2);
  if (Date.parse(to) - Date.parse(from) > 21 * DAY) from = new Date(Date.parse(to) - 21 * DAY).toISOString().slice(0, 10);
  return { today, from, to };
}
