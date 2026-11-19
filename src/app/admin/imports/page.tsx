import { requirePageRole } from "@/lib/auth";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { TimelineImporter } from "./timeline-importer";

export default async function AdminImportsPage() {
  const { supabase } = await requirePageRole(["admin"]);
  const { data: batches } = await supabase
    .from("location_import_batches")
    .select("id, source, file_name, file_hash, detected_format, status, imported_count, duplicate_count, rejected_count, error, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  return (
    <div className="space-y-6">
      <PageHeader title="Historical imports" description="Import Google Timeline exports. Re-importing the same data never creates duplicates." />
      <TimelineImporter />
      <Card>
        <h2 className="mb-2 font-semibold">Import and polling log</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="pr-3">Source</th>
                <th className="pr-3">File / format</th>
                <th className="pr-3">Status</th>
                <th className="pr-3 text-right">New</th>
                <th className="pr-3 text-right">Dupes</th>
                <th className="text-right">Rejected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(batches ?? []).map((b) => (
                <tr key={b.id}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDateTime(b.created_at)}</td>
                  <td className="pr-3">{b.source}</td>
                  <td className="pr-3">
                    {b.file_name ?? "—"} {b.detected_format && <span className="text-muted">({b.detected_format})</span>}
                    {b.file_hash && <span className="block font-mono text-[10px] text-muted">sha256 {b.file_hash.slice(0, 16)}…</span>}
                  </td>
                  <td className="pr-3">
                    <Badge tone={b.status === "completed" ? "green" : b.status === "failed" ? "red" : "neutral"}>{b.status}</Badge>
                    {b.error && <span className="block text-xs text-red-700">{b.error.slice(0, 120)}</span>}
                  </td>
                  <td className="pr-3 text-right">{b.imported_count}</td>
                  <td className="pr-3 text-right">{b.duplicate_count}</td>
                  <td className="text-right">{b.rejected_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
