import { policeReportsEnabled } from "@/lib/police-reports";
import type { Metadata } from "next";
import Link from "next/link";
import { getPublicPlans, type PublicPlan } from "@/lib/public-data";
import { Notice } from "@/components/ui";
import { Container, PageHead } from "@/components/design";
import { londonDayKey } from "@/lib/format";
import { PlanCard, PlanFilters, PlansTabs, filterQuery, planPoint, str } from "../plans-shared";
import { loadPublicZoneContext, publicZone } from "@/lib/zones";
import { WatchZonesProvider } from "@/components/watch-zones";

export const metadata: Metadata = { title: "Plans calendar" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const parseKey = (k: string) => Date.parse(`${k}T00:00:00Z`);
/** Monday-based weekday index 0..6 */
const weekday = (ms: number) => (new Date(ms).getUTCDay() + 6) % 7;

function plansByDay(plans: PublicPlan[]): Map<string, PublicPlan[]> {
  const m = new Map<string, PublicPlan[]>();
  for (const p of plans) {
    const start = parseKey(londonDayKey(p.starts_at));
    const end = parseKey(londonDayKey(p.ends_at ?? p.starts_at));
    for (let d = start, i = 0; d <= end && i < 62; d += DAY, i++) {
      const k = keyOf(d);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
  }
  // Within a day, latest time first.
  for (const list of m.values()) list.sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return m;
}

export default async function PlansCalendarPage({ searchParams }: PageProps<"/plans/calendar">) {
  const sp = await searchParams;
  const police = await policeReportsEnabled();
  const category = str(sp.category);
  const status = str(sp.status);
  const view = sp.view === "week" ? "week" : "month";
  const todayKey = londonDayKey(new Date().toISOString());
  const anchorRaw = str(sp.date);
  const anchor = anchorRaw && /^\d{4}-\d{2}-\d{2}$/.test(anchorRaw) ? anchorRaw : todayKey;
  const anchorMs = parseKey(anchor);

  const zctx = await loadPublicZoneContext();
  let rangeStart: number;
  let rangeEnd: number;
  let prev: string;
  let next: string;
  let title: string;
  if (view === "month") {
    const d = new Date(anchorMs);
    const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const last = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
    rangeStart = first - weekday(first) * DAY;
    rangeEnd = last + (6 - weekday(last)) * DAY;
    prev = keyOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    next = keyOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  } else {
    rangeStart = anchorMs - weekday(anchorMs) * DAY;
    rangeEnd = rangeStart + 6 * DAY;
    prev = keyOf(rangeStart - 7 * DAY);
    next = keyOf(rangeStart + 7 * DAY);
    title = `Week of ${new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(rangeStart)}`;
  }
  const monthOfAnchor = new Date(anchorMs).getUTCMonth();

  let plans: PublicPlan[] = [];
  let failed = false;
  try {
    plans = await getPublicPlans({
      category,
      status,
      from: new Date(rangeStart - 31 * DAY).toISOString(),
      to: new Date(rangeEnd + DAY).toISOString(),
    });
  } catch (err) {
    console.error(err);
    failed = true;
  }
  const byDay = plansByDay(plans);
  const days: number[] = [];
  for (let d = rangeStart; d <= rangeEnd; d += DAY) days.push(d);

  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (category) p.set("category", category);
    if (status) p.set("status", status);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/plans/calendar?${p.toString()}`;
  };

  return (
    <>
      <PageHead title="Where I'm going" art="plans">
        <PlansTabs active="calendar" query={filterQuery(sp, ["category", "status"])} />
      </PageHead>
      <Container className="space-y-5 pb-20 pt-6">
      <PlanFilters category={category} status={status} extra={{ view, date: anchor }} />
      {failed && <Notice tone="red">Plans could not be loaded.</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link className="rounded border border-border bg-surface px-3 py-1.5 text-sm" href={q({ view, date: prev })} aria-label="Previous">
            ←
          </Link>
          <h2 className="min-w-48 text-center font-semibold">{title}</h2>
          <Link className="rounded border border-border bg-surface px-3 py-1.5 text-sm" href={q({ view, date: next })} aria-label="Next">
            →
          </Link>
          <Link className="text-sm text-accent underline" href={q({ view, date: todayKey })}>
            Today
          </Link>
        </div>
        <div className="inline-flex rounded-md border border-border bg-surface p-1 text-sm">
          <Link className={`rounded px-3 py-1 ${view === "month" ? "bg-slate-200 font-medium" : ""}`} href={q({ view: "month", date: anchor })}>
            Month
          </Link>
          <Link className={`rounded px-3 py-1 ${view === "week" ? "bg-slate-200 font-medium" : ""}`} href={q({ view: "week", date: anchor })}>
            Week
          </Link>
        </div>
      </div>

      {view === "month" ? (
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="bg-slate-50 p-2 text-center text-xs font-semibold">
                {d}
              </div>
            ))}
            {days.map((d) => {
              const k = keyOf(d);
              const items = byDay.get(k) ?? [];
              const inMonth = new Date(d).getUTCMonth() === monthOfAnchor;
              return (
                <div key={k} className={`min-h-24 p-1.5 ${inMonth ? "bg-surface" : "bg-slate-50 text-slate-400"}`}>
                  <div className={`mb-1 text-xs ${k === todayKey ? "inline-block rounded bg-accent px-1.5 text-white" : ""}`}>
                    {new Date(d).getUTCDate()}
                  </div>
                  <ul className="space-y-1">
                    {items.slice(0, 3).map((p) => (
                      <li key={p.id}>
                        <Link
                          href={q({ view: "week", date: k })}
                          className={`block truncate rounded bg-blue-50 px-1 text-xs text-blue-900 ${p.status === "cancelled" ? "line-through opacity-70" : ""}`}
                          title={p.title}
                        >
                          {p.title}
                        </Link>
                      </li>
                    ))}
                    {items.length > 3 && <li className="text-xs text-muted">+{items.length - 3} more</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <WatchZonesProvider points={[...byDay.values()].flat().flatMap((p) => { const q = planPoint(p); return q ? [{ id: p.id, ...q, at: Date.parse(p.starts_at) }] : []; })}>
        <div className="space-y-4">
          {days.map((d) => {
            const k = keyOf(d);
            const items = byDay.get(k) ?? [];
            return (
              <section key={k}>
                <h3 className={`mb-1 text-sm font-semibold ${k === todayKey ? "text-accent" : ""}`}>
                  {new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "UTC" }).format(d)}
                </h3>
                {items.length ? (
                  <div className="space-y-2">
                    {items.map((p) => {
                      const q = planPoint(p);
                      return (
                        <PlanCard key={p.id} p={p} police={police} zone={q ? publicZone(q, zctx) : null} />
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted">No published plans.</p>
                )}
              </section>
            );
          })}
        </div>
        </WatchZonesProvider>
      )}
      </Container>
    </>
  );
}
