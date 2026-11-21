import type { Metadata } from "next";
import Link from "next/link";
import { getPublicPlans } from "@/lib/public-data";
import { Notice } from "@/components/ui";
import { Container, EmptyState, Icon, PageHead } from "@/components/design";
import { fmtDate, londonDayKey } from "@/lib/format";
import { PLAN_WINDOW_DAYS, planListOrder, windowPlans } from "@/lib/plans";
import { PlanCard, PlanFilters, PlansTabs, filterQuery, planPoint, planWhen, planWhere, str } from "./plans-shared";
import { PlanMapButton } from "./plan-map-button";
import { InfoButton } from "@/components/info-button";
import { shiftDay } from "@/lib/history-range";
import { loadPublicZoneContext, publicZone } from "@/lib/zones";
import { WatchZonesProvider } from "@/components/watch-zones";
import { WISHES_NOTE } from "@/lib/plan-wishes";

export const metadata: Metadata = { title: "Plans" };
export const dynamic = "force-dynamic";

export default async function PlansSchedulePage({ searchParams }: PageProps<"/plans">) {
  const sp = await searchParams;
  const category = str(sp.category);
  const status = str(sp.status);
  const showPast = sp.past === "1";
  const days = Math.min(366, Math.max(PLAN_WINDOW_DAYS, Number(str(sp.days)) || PLAN_WINDOW_DAYS));
  const todayKey = londonDayKey(new Date().toISOString());

  let plans: Awaited<ReturnType<typeof getPublicPlans>> = [];
  let failed = false;
  try {
    plans = await getPublicPlans({ category, status });
  } catch (err) {
    console.error(err);
    failed = true;
  }
  const { shown, beyond } = windowPlans(plans, todayKey, days, showPast ? "past" : "upcoming", londonDayKey, new Date().getTime());
  // Upcoming: in time order (date, then time). Past: latest day first, latest time first.
  const visible = planListOrder(shown, londonDayKey, showPast ? "past" : "upcoming");

  // Card colours: worked out here so my okay zone and own areas stay private.
  const zctx = await loadPublicZoneContext();
  const points = visible.flatMap((p) => {
    const q = planPoint(p);
    return q ? [{ id: p.id, ...q, at: Date.parse(p.starts_at) }] : [];
  });
  const zoneOf = new Map(points.map((q) => [q.id, publicZone(q, zctx)]));

  const groups = new Map<string, typeof visible>();
  for (const p of visible) {
    const k = londonDayKey(p.starts_at);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }

  const baseQuery = { category, status, past: showPast ? "1" : undefined };
  const moreHref = `/plans${filterQuery({ ...baseQuery, days: String(days + PLAN_WINDOW_DAYS) }, ["category", "status", "past", "days"])}`;
  const nextBeyond = showPast ? null : beyond[0];

  return (
    <>
      <PageHead
        title="Where I'm going"
        art="plans"
        lead={
          <span className="flex flex-wrap items-center gap-x-3">
            What I plan to do.
            <InfoButton label="About plans">
              <p>Plans are intentions, not GPS records. Where GPS later matches a plan, that is shown on it.</p>
            </InfoButton>
          </span>
        }
      >
        <PlansTabs active="list" query={filterQuery(sp, ["category", "status"])} />
      </PageHead>
      <Container className="space-y-5 pb-20 pt-6">
        <p className="rounded-lg border border-hairline bg-white px-4 py-3 text-sm text-muted">{WISHES_NOTE}</p>
        {!showPast && !failed && (() => {
          // The next 7 days with a dot for each plan, then the next plan in full.
          const week = [0, 1, 2, 3, 4, 5, 6].map((i) => shiftDay(todayKey, i));
          const next = visible.find((p) => p.status !== "cancelled");
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-7 gap-1.5" role="list" aria-label="The next 7 days">
                {week.map((d) => {
                  const n = (groups.get(d) ?? []).length;
                  const dt = new Date(`${d}T12:00:00Z`);
                  return (
                    <a
                      key={d}
                      role="listitem"
                      href={n ? `#day-${d}` : `/plans/calendar${filterQuery(sp, ["category", "status"])}`}
                      aria-label={`${fmtDate(`${d}T12:00:00Z`, { dateStyle: "full" })}: ${n ? `${n} plan${n === 1 ? "" : "s"}` : "no plans"}`}
                      className={`flex flex-col items-center gap-1 rounded-xl py-2 ${d === todayKey ? "bg-navy text-white" : "bg-white text-ink hover:bg-ice"} border border-hairline`}
                    >
                      <span className="text-[11px] font-semibold uppercase opacity-80">{dt.toLocaleDateString("en-GB", { weekday: "short" })}</span>
                      <span className="font-display text-lg font-bold leading-none tabular-nums">{dt.getUTCDate()}</span>
                      <span className="flex h-2 gap-0.5" aria-hidden="true">
                        {[0, 1, 2].slice(0, Math.min(n, 3)).map((i) => (
                          <span key={i} className={`h-1.5 w-1.5 rounded-full ${d === todayKey ? "bg-signal" : "bg-accent"}`} />
                        ))}
                      </span>
                    </a>
                  );
                })}
              </div>
              {next && (
                <div className="space-y-3 rounded-2xl bg-accent p-4 text-white shadow-[0_8px_24px_rgb(36_90_214/25%)] sm:p-5">
                  <p className="text-xs font-bold uppercase tracking-[.08em] text-blue-100">Next up</p>
                  <p className="font-display text-xl font-bold leading-snug">{next.title}</p>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-blue-100">
                    <span className="inline-flex items-center gap-1.5"><Icon name="clock" className="h-4 w-4" />{planWhen(next)}</span>
                    <span className="inline-flex items-center gap-1.5"><Icon name="pin" className="h-4 w-4" />{planWhere(next)}</span>
                  </p>
                  {planPoint(next) && (
                    <PlanMapButton plan={next} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-white px-3.5 text-sm font-semibold text-ink">
                      <Icon name="map" className="h-4 w-4" /> Show on map
                    </PlanMapButton>
                  )}
                </div>
              )}
            </div>
          );
        })()}
        <PlanFilters category={category} status={status} extra={{ past: showPast ? "1" : undefined }} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="font-semibold">
            {showPast ? `Past plans: the last ${days} days` : `Schedule: the next ${days} days`}
          </p>
          {showPast ? (
            <Link className="text-accent underline" href={`/plans${filterQuery(sp, ["category", "status"])}`}>
              ← Back to upcoming plans
            </Link>
          ) : (
            <Link className="text-accent underline" href={`/plans${filterQuery({ ...sp, past: "1" }, ["category", "status", "past"])}`}>
              Past plans →
            </Link>
          )}
        </div>
        {failed && <Notice tone="red">Plans could not be loaded. Please try again later.</Notice>}
        {!failed && !visible.length && (
          <EmptyState icon="calendar" title={showPast ? `Nothing in the last ${days} days.` : `Nothing planned in the next ${days} days.`}>
            {beyond.length
              ? showPast
                ? "There are older plans: show more below."
                : `The next plan is on ${fmtDate(nextBeyond!.starts_at, { dateStyle: "full" })}. Show more below, or use the calendar.`
              : showPast
                ? "Try clearing the filters."
                : "New plans appear here as soon as I add them."}
          </EmptyState>
        )}
        <WatchZonesProvider points={points}>
        <div className="space-y-6">
          {[...groups.entries()].map(([day, items]) => (
            <section key={day} id={`day-${day}`} className="scroll-mt-28">
              <h2 className="mb-3 text-lg font-bold">{fmtDate(`${day}T12:00:00Z`, { dateStyle: "full" })}</h2>
              <div className="space-y-3">
                {items.map((p) => (
                  <PlanCard key={p.id} p={p} zone={zoneOf.get(p.id) ?? null} />
                ))}
              </div>
            </section>
          ))}
        </div>
        </WatchZonesProvider>
        {beyond.length > 0 && (
          <div className="flex flex-col items-center gap-2 border-t border-hairline pt-6 text-center">
            <Link
              href={moreHref}
              scroll={false}
              className="inline-flex h-12 items-center gap-2 rounded-[var(--ft-radius-control)] border border-border bg-white px-5 font-semibold hover:bg-sky"
            >
              <Icon name="calendar" /> {showPast ? `Show the previous ${PLAN_WINDOW_DAYS} days` : `Show the next ${PLAN_WINDOW_DAYS} days`}
            </Link>
            <p className="text-xs text-muted">
              {beyond.length} more plan{beyond.length === 1 ? "" : "s"} {showPast ? "earlier" : "later"}. Looking for a particular date?{" "}
              <Link className="text-accent underline" href={`/plans/calendar${filterQuery(sp, ["category", "status"])}`}>
                Use the calendar
              </Link>
              .
            </p>
          </div>
        )}
      </Container>
    </>
  );
}
