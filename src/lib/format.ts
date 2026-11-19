export const TIME_ZONE = "Europe/London";

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, dateStyle: "medium", ...opts }).format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, timeStyle: "short" }).format(new Date(iso));
}

/** YYYY-MM-DD in London time. */
export function londonDayKey(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
  return parts;
}

export function relativeAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}
