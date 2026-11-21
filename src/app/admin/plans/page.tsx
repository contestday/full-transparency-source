import { requirePageRole } from "@/lib/auth";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { WISH_LABELS, WISHES_NOTE, type WishKind } from "@/lib/plan-wishes";
import { PlansEditor, type PlanWithLocations, type VenueOption } from "./plans-editor";

export default async function AdminPlansPage() {
  const { supabase } = await requirePageRole(["admin"]);
  const [{ data: plans }, { data: venues }, { data: visits }, { data: wishes }] = await Promise.all([
    supabase.from("planned_activities").select("*, plan_locations(venue_id, position)").eq("archived", false).order("starts_at", { ascending: true }).limit(500),
    supabase.from("venues").select("id, name, category, public_area_label, lat, lng, is_public, is_hidden").order("name").limit(1000),
    supabase.from("visits").select("id, planned_activity_id, started_at, ended_at").not("planned_activity_id", "is", null).limit(1000),
    supabase.from("plan_wishes").select("id, plan_id, kind, reason, created_at, planned_activities(title, starts_at)").order("created_at", { ascending: false }).limit(200),
  ]);
  const visitsByPlan: Record<string, { started_at: string; ended_at: string }[]> = {};
  for (const v of visits ?? []) {
    (visitsByPlan[v.planned_activity_id] ??= []).push({ started_at: v.started_at, ended_at: v.ended_at });
  }
  const wishList = (wishes ?? []) as unknown as {
    id: string;
    kind: WishKind;
    reason: string | null;
    created_at: string;
    planned_activities: { title: string; starts_at: string } | null;
  }[];
  return (
    <div className="space-y-8">
      <div>
        <PageHeader title="Plans editor" description="Create and publish plans to the public Plans Board." />
        <PlansEditor initialPlans={(plans ?? []) as PlanWithLocations[]} venues={(venues ?? []) as VenueOption[]} visitsByPlan={visitsByPlan} />
      </div>
      <section id="wishes" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-semibold">Permissions and objections</h2>
        <p className="text-sm text-muted">{WISHES_NOTE} Only you see these: nothing about them is shown publicly.</p>
        {wishList.length > 0 && (
          <p className="text-sm font-semibold">
            {wishList.filter((w) => w.kind === "permission").length} permission{wishList.filter((w) => w.kind === "permission").length === 1 ? "" : "s"} ·{" "}
            {wishList.filter((w) => w.kind === "objection").length} objection{wishList.filter((w) => w.kind === "objection").length === 1 ? "" : "s"}
            {wishList.length >= 200 ? " (latest 200)" : ""}
          </p>
        )}
        {wishList.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <Card className="divide-y divide-border p-0">
            {wishList.map((w) => (
              <div key={w.id} className="space-y-1 p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={w.kind === "permission" ? "green" : "amber"}>{WISH_LABELS[w.kind]}</Badge>
                  <span className="font-medium">{w.planned_activities?.title ?? "Deleted plan"}</span>
                  {w.planned_activities && <span className="text-muted">· {fmtDateTime(w.planned_activities.starts_at)}</span>}
                  <span className="ml-auto text-xs text-muted">{fmtDateTime(w.created_at)}</span>
                </p>
                {w.reason ? <p className="whitespace-pre-line">{w.reason}</p> : <p className="text-muted">No reason given.</p>}
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
