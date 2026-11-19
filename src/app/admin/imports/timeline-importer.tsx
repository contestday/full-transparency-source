"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { ApiError, api } from "@/lib/client-api";
import { parseTimeline, type ParseResult } from "@/lib/timeline/parse";
import { sha256Hex } from "@/lib/crypto";
import { fmtDateTime } from "@/lib/format";

const MAX_FILE_BYTES = 750 * 1024 * 1024;
const CHUNK = 2000;

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; name: string }
  | { kind: "preview"; file: { name: string; size: number; hash: string }; result: ParseResult }
  | { kind: "importing"; done: number; total: number }
  | { kind: "finished"; summary: { imported_count: number; duplicate_count: number; rejected_count: number } }
  | { kind: "error"; message: string };

export function TimelineImporter() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [duplicateOf, setDuplicateOf] = useState<Extract<Phase, { kind: "preview" }> | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
      setPhase({ kind: "error", message: "Please choose a .json file from a Google Timeline export." });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setPhase({ kind: "error", message: "File is larger than 750 MB. Split it (e.g. monthly Semantic Location History files) and import each." });
      return;
    }
    setPhase({ kind: "reading", name: file.name });
    try {
      const buf = await file.arrayBuffer();
      const hash = await sha256Hex(buf);
      const data = JSON.parse(new TextDecoder().decode(buf));
      const result = parseTimeline(data);
      setPhase({ kind: "preview", file: { name: file.name, size: file.size, hash }, result });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof SyntaxError ? "The file is not valid JSON." : e instanceof Error ? e.message : "Could not read file" });
    }
  }

  async function runImport(p: Extract<Phase, { kind: "preview" }>, force = false) {
    const { result, file } = p;
    let batchId: string;
    try {
      const start = await api<{ batch_id: string }>("/api/imports/timeline", {
        method: "POST",
        json: {
          action: "start",
          file_name: file.name,
          file_hash: file.hash,
          file_size: file.size,
          format: result.format,
          total_records: result.observations.length,
          rejected_in_file: result.rejected.length,
          duplicates_in_file: result.duplicatesInFile,
          force,
        },
      });
      batchId = start.batch_id;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setDuplicateOf(p);
        return;
      }
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Import failed to start" });
      return;
    }

    const total = result.observations.length;
    setPhase({ kind: "importing", done: 0, total });
    try {
      for (let i = 0; i < total; i += CHUNK) {
        const chunk = result.observations.slice(i, i + CHUNK).map((o) => ({
          observedAt: o.observedAt,
          lat: o.lat,
          lng: o.lng,
          accuracyM: o.accuracyM,
          metadata: o.metadata,
        }));
        await api("/api/imports/timeline", { method: "POST", json: { action: "chunk", batch_id: batchId, observations: chunk } });
        setPhase({ kind: "importing", done: Math.min(total, i + CHUNK), total });
      }
      const fin = await api<{ summary: { imported_count: number; duplicate_count: number; rejected_count: number } }>("/api/imports/timeline", {
        method: "POST",
        json: { action: "finish", batch_id: batchId, status: "completed" },
      });
      setPhase({ kind: "finished", summary: fin.summary });
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Import failed";
      await api("/api/imports/timeline", { method: "POST", json: { action: "finish", batch_id: batchId, status: "failed", error: message } }).catch(() => {});
      setPhase({ kind: "error", message: `${message}. Records already imported are kept; re-running the import is safe.` });
      router.refresh();
    }
  }

  const reasons =
    phase.kind === "preview"
      ? Object.entries(
          phase.result.rejected.reduce<Record<string, number>>((acc, r) => {
            acc[r.reason] = (acc[r.reason] ?? 0) + 1;
            return acc;
          }, {}),
        )
      : [];

  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">Import Google Timeline</h2>
      <p className="text-sm text-muted">
        Supported: Takeout <code>Records.json</code>, Takeout Semantic Location History monthly files, and on-device
        Timeline exports from Android (<code>Timeline.json</code>) or iOS. The file is parsed in your browser and
        only validated location records are uploaded.
      </p>
      {(phase.kind === "idle" || phase.kind === "error" || phase.kind === "finished") && (
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-4 file:py-2 file:text-white"
        />
      )}
      {phase.kind === "reading" && <p className="text-sm">Reading and validating {phase.name}…</p>}
      {phase.kind === "error" && <Notice tone="red">{phase.message}</Notice>}
      {phase.kind === "preview" && (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Format</dt>
              <dd>
                <Badge tone="blue">{phase.result.format}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Valid records</dt>
              <dd className="font-semibold">{phase.result.observations.length.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Invalid</dt>
              <dd>{phase.result.rejected.length.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Duplicates in file</dt>
              <dd>{phase.result.duplicatesInFile.toLocaleString()}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted">Date range</dt>
              <dd>
                {fmtDateTime(phase.result.firstObservedAt)} → {fmtDateTime(phase.result.lastObservedAt)}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted">SHA-256</dt>
              <dd className="truncate font-mono text-xs">{phase.file.hash}</dd>
            </div>
          </dl>
          {reasons.length > 0 && (
            <ul className="text-xs text-muted">
              {reasons.map(([r, n]) => (
                <li key={r}>
                  {n.toLocaleString()} × {r}
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="pr-2">Observed</th>
                  <th className="pr-2">Lat</th>
                  <th className="pr-2">Lng</th>
                  <th className="pr-2">Accuracy</th>
                  <th>Kind</th>
                </tr>
              </thead>
              <tbody>
                {phase.result.observations.slice(0, 8).map((o) => (
                  <tr key={o.sourceRecordId}>
                    <td className="pr-2">{fmtDateTime(o.observedAt)}</td>
                    <td className="pr-2">{o.lat.toFixed(5)}</td>
                    <td className="pr-2">{o.lng.toFixed(5)}</td>
                    <td className="pr-2">{o.accuracyM ?? "—"}</td>
                    <td>{o.metadata.kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Records already in the database are detected and skipped during import.</p>
          {duplicateOf && (
            <Notice tone="amber">
              This exact file has been imported before. Importing again is safe: existing records are skipped, not
              duplicated.
              <span className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => { const p = duplicateOf; setDuplicateOf(null); void runImport(p, true); }}>
                  Import again
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDuplicateOf(null)}>
                  Cancel
                </Button>
              </span>
            </Notice>
          )}
          <div className="flex gap-2">
            <Button onClick={() => runImport(phase)} disabled={!phase.result.observations.length}>
              Import {phase.result.observations.length.toLocaleString()} records
            </Button>
            <Button variant="ghost" onClick={() => setPhase({ kind: "idle" })}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {phase.kind === "importing" && (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuenow={phase.done} aria-valuemax={phase.total}>
            <div className="h-full bg-accent transition-all" style={{ width: `${(phase.done / Math.max(1, phase.total)) * 100}%` }} />
          </div>
          <p className="text-sm">
            {phase.done.toLocaleString()} / {phase.total.toLocaleString()}. Keep this page open.
          </p>
        </div>
      )}
      {phase.kind === "finished" && (
        <Notice tone="green" title="Import complete">
          {phase.summary.imported_count.toLocaleString()} new · {phase.summary.duplicate_count.toLocaleString()} already present ·{" "}
          {phase.summary.rejected_count.toLocaleString()} rejected
        </Notice>
      )}
    </Card>
  );
}
