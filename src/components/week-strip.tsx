import Link from "next/link";
import { STATUS_TONE } from "@/components/design";

export interface WeekDay {
  /** London day, YYYY-MM-DD. */
  date: string;
  /** Minutes of published stays that day, by public colour. */
  green: number;
  yellow: number;
  red: number;
}

const SEG: { key: "green" | "yellow" | "red"; color: string; label: string }[] = [
  { key: "red", color: "#C62828", label: "in a noted area" },
  { key: "yellow", color: "#F7D85A", label: "outside the okay zone" },
  { key: "green", color: "#007B60", label: "within the okay zone" },
];

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

/**
 * This week, Monday to Sunday: each day's published stay time stacked by
 * colour. Today outlined; days still to come dashed. Each day links to its
 * History, and the whole strip has a text description.
 */
export function WeekStrip({ days, today }: { days: WeekDay[]; today: string }) {
  const max = Math.max(60, ...days.map((d) => d.green + d.yellow + d.red));
  const total = days.reduce((s, d) => s + d.green + d.yellow + d.red, 0);
  const okay = days.reduce((s, d) => s + d.green, 0);
  const summary = days
    .filter((d) => d.date <= today)
    .map((d) => `${new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long" })}: ${d.green + d.yellow + d.red ? SEG.filter((s) => d[s.key]).map((s) => `${hm(d[s.key])} ${s.label}`).join(", ") : "no stays published"}`)
    .join(". ");
  return (
    <div className="space-y-3">
      <div className="grid h-[60px] grid-cols-7 items-end gap-2" role="img" aria-label={`Stay time this week. ${summary}.`}>
        {days.map((d) => {
          const sum = d.green + d.yellow + d.red;
          const future = d.date > today;
          return future ? (
            <span key={d.date} className="h-full rounded-md border border-dashed border-border bg-[#F1F5F9]" />
          ) : (
            <Link
              key={d.date}
              href={`/history?from=${d.date}&to=${d.date}`}
              aria-label={`History for ${d.date}`}
              className={`flex h-full flex-col justify-end overflow-hidden rounded-md bg-grey-bg ${d.date === today ? "outline outline-2 outline-offset-2 outline-ink" : ""}`}
            >
              <span className="flex flex-col overflow-hidden" style={{ height: `${Math.max(sum ? 8 : 0, (sum / max) * 100)}%` }}>
                {SEG.map((s) => (d[s.key] ? <span key={s.key} style={{ flex: d[s.key], background: s.color }} /> : null))}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="-mt-1.5 grid grid-cols-7 gap-2 text-center text-xs text-muted" aria-hidden="true">
        {days.map((d) => (
          <span key={d.date} className={d.date === today ? "font-bold text-ink" : undefined}>
            {new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "narrow" })}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: STATUS_TONE.green.dot }} />
          Within okay zone
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: STATUS_TONE.yellow.dot }} />
          Outside it
        </span>
      </div>
      {total > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-green-bg px-3 py-2.5 text-green-ink">
            <p className="font-display text-xl font-bold leading-tight tabular-nums">{Math.round((okay / total) * 100)}%</p>
            <p className="text-xs">of stay time this week within okay zone</p>
          </div>
          <div className="rounded-xl bg-ice px-3 py-2.5 text-[#1947B5]">
            <p className="font-display text-xl font-bold leading-tight tabular-nums">{hm(total)}</p>
            <p className="text-xs">of stays published this week</p>
          </div>
        </div>
      )}
    </div>
  );
}
