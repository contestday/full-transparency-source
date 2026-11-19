import type { Metadata } from "next";
import { planEndMs } from "@/lib/plan-outcome";
import { getPublicPlans, type PublicPlan } from "@/lib/public-data";
import { Notice } from "@/components/ui";
import { Container, PageHead } from "@/components/design";
import { PlanFilters, PlansTabs, filterQuery, str } from "../plans-shared";
import { PlansMap } from "./plans-map";

export const metadata: Metadata = { title: "Plans map" };
export const dynamic = "force-dynamic";

export default async function PlansMapPage({ searchParams }: PageProps<"/plans/map">) {
  const sp = await searchParams;
  const category = str(sp.category);
  const status = str(sp.status);
  let plans: PublicPlan[] = [];
  let failed = false;
  try {
    plans = await getPublicPlans({ category, status });
  } catch (err) {
    console.error(err);
    failed = true;
  }
  const now = new Date().getTime();
  // Upcoming = not finished yet (a plan moves to past as soon as it ends).
  const upcoming = plans.filter((p) => planEndMs({ starts_at: p.starts_at, ends_at: p.ends_at, all_day: Boolean(p.all_day) }) >= now);
  const mapped = upcoming.filter((p) => (p.public_lat != null && p.public_lng != null) || p.extra_locations.some((l) => l.public_lat != null));

  return (
    <>
      <PageHead
        eyebrow="Upcoming plans"
        title="Plans map"
        art="plans"
        lead="Upcoming plans with a published location. Dashed squares mark a general area; pins are public venues."
      >
        <PlansTabs active="map" query={filterQuery(sp, ["category", "status"])} />
      </PageHead>
      <Container className="space-y-5 pb-20 pt-6">
      <PlanFilters category={category} status={status} />
      {failed && <Notice tone="red">Plans could not be loaded.</Notice>}
      <PlansMap plans={mapped} />
      <p className="text-xs text-muted">
        {mapped.length} of {upcoming.length} upcoming plans have a published location.
      </p>
      </Container>
    </>
  );
}
