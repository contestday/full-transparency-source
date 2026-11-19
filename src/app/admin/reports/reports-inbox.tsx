"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Notice, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/client-api";
import { REPORT_CATEGORIES, REPORT_STATUSES, REPORT_STATUS_LABELS, type ReportStatus } from "@/lib/reports";
import { fmtDateTime } from "@/lib/format";

export interface ReportSummary {
  id: string;
  reference: string;
  category: string;
  status: ReportStatus;
  created_at: string;
  incident_at: string | null;
  general_location: string | null;
  related_geofence_reference: string | null;
}

interface Detail {
  report: {
    id: string;
    reference: string;
    category: string;
    description: string;
    incident_at: string | null;
    incident_time_approximate: boolean;
    general_location: string | null;
    contact_info: string | null;
    related_geofence_reference: string | null;
    status: ReportStatus;
    created_at: string;
  };
  notes: { id: string; body: string; author_id: string; created_at: string }[];
  attachments: { id: string; mime_type: string; size_bytes: number; url: string | null }[];
  audit: { id: string; action: string; actor_id: string | null; actor_label: string | null; metadata: Record<string, unknown>; created_at: string }[];
}

const TONE: Record<ReportStatus, "blue" | "amber" | "neutral" | "green" | "red"> = {
  new: "blue",
  under_review: "amber",
  awaiting_information: "neutral",
  closed: "green",
  flagged_abuse: "red",
};

export function ReportsInbox({ reports, status, openRef }: { reports: ReportSummary[]; status: string; openRef: string | null }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(() => reports.find((r) => r.reference === openRef)?.id ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async (id: string) => {
    setError(null);
    try {
      setDetail(await api<Detail>(`/api/admin/reports/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (openId) void loadDetail(openId);
  }, [openId, loadDetail]);

  async function update(body: { status?: ReportStatus; note?: string }) {
    if (!openId) return;
    try {
      await api(`/api/admin/reports/${openId}`, { method: "PATCH", json: body });
      setNote("");
      await loadDetail(openId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <div className="space-y-2">
        <Select value={status} onChange={(e) => router.push(`/admin/reports${e.target.value ? `?status=${e.target.value}` : ""}`)} aria-label="Status filter">
          <option value="">All statuses</option>
          {REPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {REPORT_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <ul className="max-h-[70vh] space-y-1 overflow-y-auto">
          {!reports.length && <li className="text-sm text-muted">No reports.</li>}
          {reports.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpenId(r.id)}
                className={`w-full rounded-md border p-3 text-left text-sm ${r.id === openId ? "border-accent bg-blue-50" : "border-border bg-surface hover:bg-slate-50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{r.reference}</span>
                  <Badge tone={TONE[r.status]}>{REPORT_STATUS_LABELS[r.status]}</Badge>
                </div>
                <p className="text-xs text-muted">
                  {REPORT_CATEGORIES[r.category as keyof typeof REPORT_CATEGORIES] ?? r.category} · {fmtDateTime(r.created_at)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        {error && <Notice tone="red">{error}</Notice>}
        {!openId && <p className="text-sm text-muted">Select a report.</p>}
        {openId && detail && detail.report.id === openId && (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-mono text-lg font-semibold">{detail.report.reference}</h2>
              <Select value={detail.report.status} onChange={(e) => update({ status: e.target.value as ReportStatus })} className="w-auto" aria-label="Change status">
                {REPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {REPORT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">Category</dt>
                <dd>{REPORT_CATEGORIES[detail.report.category as keyof typeof REPORT_CATEGORIES] ?? detail.report.category}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Submitted</dt>
                <dd>{fmtDateTime(detail.report.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Incident</dt>
                <dd>
                  {detail.report.incident_at ? (detail.report.incident_time_approximate ? `${fmtDateTime(detail.report.incident_at).split(",")[0]} (time not given)` : fmtDateTime(detail.report.incident_at)) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">General location</dt>
                <dd>{detail.report.general_location ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Related area</dt>
                <dd className="font-mono">{detail.report.related_geofence_reference ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Contact (optional)</dt>
                <dd>{detail.report.contact_info ?? "Anonymous"}</dd>
              </div>
            </dl>
            <div>
              <p className="text-xs text-muted">Description</p>
              <p className="whitespace-pre-line rounded bg-slate-50 p-3 text-sm">{detail.report.description}</p>
            </div>
            {detail.attachments.length > 0 && (
              <div>
                <p className="text-xs text-muted">Attachments (links expire after 5 minutes)</p>
                <ul className="text-sm">
                  {detail.attachments.map((a) => (
                    <li key={a.id}>
                      {a.url ? (
                        <a className="text-accent underline" href={a.url} target="_blank" rel="noopener noreferrer">
                          {a.mime_type} · {Math.round(a.size_bytes / 1024)} KB
                        </a>
                      ) : (
                        "Unavailable"
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-2">
              <p className="font-semibold">Private notes</p>
              <ul className="space-y-2 text-sm">
                {detail.notes.map((n) => (
                  <li key={n.id} className="rounded border border-border p-2">
                    <p className="whitespace-pre-line">{n.body}</p>
                    <p className="text-xs text-muted">{fmtDateTime(n.created_at)}</p>
                  </li>
                ))}
              </ul>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a private note…" rows={3} />
              <Button size="sm" disabled={!note.trim()} onClick={() => update({ note })}>
                Add note
              </Button>
            </div>
            {detail.audit.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-semibold">Audit history</summary>
                <ul className="mt-2 space-y-1 text-xs text-muted">
                  {detail.audit.map((a) => (
                    <li key={a.id}>
                      {fmtDateTime(a.created_at)} · {a.action} · {a.actor_label ?? a.actor_id?.slice(0, 8)}
                      {a.metadata?.from ? ` · ${String(a.metadata.from)} → ${String(a.metadata.to)}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
