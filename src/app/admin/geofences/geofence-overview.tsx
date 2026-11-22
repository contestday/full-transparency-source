import { Card } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { OVERVIEW_HEX, type ActivityItem, type OverviewRow } from "@/lib/geofence/overview";

function Dot({ hex }: { hex: string }) {
  return <span aria-hidden className="inline-block size-3 shrink-0 rounded-full" style={{ background: hex }} />;
}

/** Counts in place by colour (mine and others apart), then when each was added or removed. */
export function GeofenceOverview({ rows, activity }: { rows: OverviewRow[]; activity: ActivityItem[] }) {
  const totalMine = rows.reduce((n, r) => n + (r.mine ?? 0), 0);
  const totalOthers = rows.reduce((n, r) => n + r.others, 0);
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="mb-1 text-lg font-semibold">In place now</h2>
        <p className="mb-3 text-xs text-muted">Areas, and events that are on now or coming up.</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-medium">Colour</th>
              <th className="pb-2 text-right font-medium">Mine</th>
              <th className="pb-2 text-right font-medium">Others</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.colour} className="border-t border-border align-top">
                <td className="py-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <Dot hex={r.hex} /> {r.label}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <span className="text-base font-semibold tabular-nums">{r.mine ?? "–"}</span>
                  {r.mineNote && <span className="block text-xs text-muted">{r.mineNote}</span>}
                </td>
                <td className="py-2 text-right">
                  <span className="text-base font-semibold tabular-nums">{r.others}</span>
                  {r.othersNote && <span className="block text-xs text-muted">{r.othersNote}</span>}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-border">
              <td className="py-2 font-semibold">Total</td>
              <td className="py-2 text-right font-semibold tabular-nums">{totalMine}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{totalOthers}</td>
            </tr>
          </tbody>
        </table>
      </Card>
      <Card className="p-5">
        <h2 className="mb-1 text-lg font-semibold">Added and removed</h2>
        <p className="mb-3 text-xs text-muted">Last 30 days, newest first. Type and time only: private Locations never show where.</p>
        {activity.length === 0 ? (
          <p className="text-sm text-muted">Nothing added or removed in the last 30 days.</p>
        ) : (
          <ul className="max-h-80 space-y-0 overflow-y-auto text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-2 border-t border-border py-2 first:border-t-0">
                <span className="mt-1">
                  <Dot hex={OVERVIEW_HEX[a.colour]} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">
                    {a.verb}: {a.type}
                  </span>
                  <span className="block text-xs text-muted">
                    {fmtDateTime(a.at)} · {a.who}
                    {a.reference ? ` · ${a.reference}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
