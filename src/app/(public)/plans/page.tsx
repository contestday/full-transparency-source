import type { Metadata } from "next";
import Link from "next/link";
import { getPublicPlans } from "@/lib/public-data";
import { Notice } from "@/components/ui";
import { Container, EmptyState, Icon, PageHead } from "@/components/design";
import { fmtDate, londonDayKey } from "@/lib/format";
import { PLAN_WINDOW_DAYS, planListOrder, windowPlans } from "@/lib/plans";
import { PlanCard, PlanFilters, PlansTabs, filterQuery, planPoint, str } from "./plans-shared";
import { loadPublicZoneContext, publicZone } from "@/lib/zones";
import { WatchZonesProvider } from "@/components/watch-zones";

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
        lead="What I plan to do. Plans are intentions, not GPS records."
      >
        <PlansTabs active="list" query={filterQuery(sp, ["category", "status"])} />
      </PageHead>
      <Container className="space-y-5 pb-20 pt-6">
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
            <section key={day}>
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
