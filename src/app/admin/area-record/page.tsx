import { requirePageRole } from "@/lib/auth";
import { Badge, Card, PageHeader } from "@/components/ui";
import { createServiceClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Version {
  geofence_id: string;
  reference: string;
  tier: "wide" | "local";
  wide_mode: "inside" | "outside" | null;
  shape_type: string | null;
  description: string | null;
  effective_from: string;
  effective_until: string | null;
  recorded_at: string;
  replaces_reference: string | null;
}

/**
 * The dated record of watchers' Wish and Want areas: when each came into
 * effect and when it changed or was removed. It shows what was set and when,
 * never who set it. Nothing counts from before 18 Nov 2026 20:00 GMT. Rows
 * can't be edited or deleted (database rule). Locations are never shown.
 */
export default async function AreaRecordPage() {
  await requirePageRole(["admin"]);
  const { data } = await createServiceClient()
    .from("geofence_versions")
    .select("geofence_id, reference, tier, wide_mode, shape_type, description, effective_from, effective_until, recorded_at, replaces_reference")
    .in("tier", ["wide", "local"])
    .order("effective_from", { ascending: false })
    .limit(2000);
  const versions = (data ?? []) as Version[];
  const byArea = new Map<string, Version[]>();
  for (const v of versions) byArea.set(v.reference, [...(byArea.get(v.reference) ?? []), v]);
  const areas = [...byArea.entries()].map(([reference, vs]) => ({ reference, vs, current: vs.find((v) => !v.effective_until) ?? null, first: vs[vs.length - 1] }));
  // Redrawn areas: which new area replaced which.
  const replacedBy = new Map(versions.filter((v) => v.replaces_reference).map((v) => [v.replaces_reference as string, v.reference]));
  areas.sort((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)) || b.vs[0].effective_from.localeCompare(a.vs[0].effective_from));

  const kind = (v: Version) =>
    v.tier === "local" ? "Want" : v.shape_type === "beyond_home" || v.wide_mode === "outside" ? "Wish (rather I didn't leave)" : "Wish (rather I didn't go in)";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Area record"
        description="Every Wish and Want area with the date and time it came into effect, and when it changed or ended. It records what was set and when, never who set it. Nothing counts from before 18 November 2026, 20:00 GMT, and this record can't be edited or deleted."
      />
      {!areas.length && <p className="text-sm text-muted">No Wish or Want areas yet.</p>}
      <div className="space-y-3">
        {areas.map((a) => (
          <Card key={a.reference} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{a.reference}</span>
              <Badge tone={a.vs[0].tier === "local" ? "red" : "amber"}>{kind(a.vs[0])}</Badge>
              {a.current ? <Badge tone="green">In effect</Badge> : <Badge tone="neutral">Ended</Badge>}
              {a.vs[0].description && <span className="text-sm text-muted">{a.vs[0].description.split("\n")[0]}</span>}
            </div>
            {a.first.replaces_reference && <p className="text-sm">Replaces {a.first.replaces_reference} (redrawn at the moment this one started)</p>}
            {replacedBy.get(a.reference) && <p className="text-sm">Replaced by {replacedBy.get(a.reference)} (redrawn; this one ended at that moment)</p>}
            <ol className="space-y-1 border-l-2 border-hairline pl-3 text-sm">
              {a.vs.map((v, i) => (
                <li key={`${v.effective_from}-${i}`} className="tabular-nums">
                  <strong>{fmtDateTime(v.effective_from)}</strong> to {v.effective_until ? fmtDateTime(v.effective_until) : "now"}
                  {i === a.vs.length - 1 ? " · first set" : " · changed"}
                  {v.effective_until && i === 0 && !a.current ? " · then removed" : ""}
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
    </div>
  );
}
