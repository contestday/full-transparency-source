import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicPlan } from "@/lib/public-data";
import { loadPoliceContact } from "@/lib/police-contact";
import { PRIVATE_LOCATION_LABEL, STATUS_LABELS, categoryLabel, type PlanStatus } from "@/lib/plans";
import { planStops, type PlanFacts } from "@/lib/plan-police";
import { Container, PageHead } from "@/components/design";
import { planWhen, planWhere } from "../../plans-shared";
import { PlanPoliceReport } from "./plan-police-report";

export const metadata: Metadata = {
  title: "Report a plan to the police",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PlanPolicePage({ params }: PageProps<"/plans/[id]/police">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [plan, contact] = await Promise.all([getPublicPlan(id).catch(() => null), loadPoliceContact().catch(() => null)]);
  if (!plan) notFound();
  const facts: PlanFacts = {
    title: plan.title,
    category: categoryLabel(plan.category),
    when: planWhen(plan),
    where: planWhere(plan),
    stops: planStops(plan, PRIVATE_LOCATION_LABEL),
    status: STATUS_LABELS[plan.status as PlanStatus] ?? plan.status,
    description: plan.description,
    link: "/plans?past=1",
  };
  return (
    <>
      <PageHead
        title="Report a plan to the police"
        lead="If you think this plan is illegal, you can tell the police. You write your concern; you send it."
      />
      <Container className="max-w-3xl space-y-6 pb-20 pt-6">
        <PlanPoliceReport planId={plan.id} facts={facts} contact={contact} />
      </Container>
    </>
  );
}
