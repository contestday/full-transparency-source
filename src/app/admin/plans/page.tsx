import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { PlansEditor, type PlanWithLocations, type VenueOption } from "./plans-editor";

export default async function AdminPlansPage() {
  const { supabase } = await requirePageRole(["admin"]);
  const [{ data: plans }, { data: venues }, { data: visits }] = await Promise.all([
    supabase.from("planned_activities").select("*, plan_locations(venue_id, position)").eq("archived", false).order("starts_at", { ascending: true }).limit(500),
    supabase.from("venues").select("id, name, category, public_area_label, lat, lng, is_public").order("name").limit(1000),
    supabase.from("visits").select("id, planned_activity_id, started_at, ended_at").not("planned_activity_id", "is", null).limit(1000),
  ]);
  const visitsByPlan: Record<string, { started_at: string; ended_at: string }[]> = {};
  for (const v of visits ?? []) {
    (visitsByPlan[v.planned_activity_id] ??= []).push({ started_at: v.started_at, ended_at: v.ended_at });
  }
  return (
    <div>
      <PageHeader title="Plans editor" description="Create and publish plans to the public Plans Board." />
      <PlansEditor initialPlans={(plans ?? []) as PlanWithLocations[]} venues={(venues ?? []) as VenueOption[]} visitsByPlan={visitsByPlan} />
    </div>
  );
}
