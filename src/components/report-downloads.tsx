"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { downloadCsv, downloadReport, type ReportFormat } from "@/lib/report-files";

const FORMATS: { f: ReportFormat; label: string }[] = [
  { f: "pdf", label: "PDF" },
  { f: "doc", label: "Word (.doc)" },
  { f: "txt", label: "Text (.txt)" },
];

/** Download the finished report as PDF, Word or text. */
export function ReportDownloads({
  title,
  base,
  text,
  html,
  disabled,
  onDone,
  csv,
}: {
  title: string;
  base: string;
  text: () => string;
  html?: () => string | undefined;
  disabled?: boolean;
  onDone?: (format: ReportFormat) => void;
  /** A spreadsheet that goes with the report (every GPS reading), if any. */
  csv?: { label: string; base: string; text: () => string } | null;
}) {
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [error, setError] = useState(false);

  async function go(f: ReportFormat) {
    setBusy(f);
    setError(false);
    try {
      await downloadReport(f, { title, base, text: text(), html: html?.() });
      onDone?.(f);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold">Download your report</p>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map(({ f, label }) => (
          <Button key={f} type="button" variant="secondary" disabled={disabled || busy !== null} onClick={() => go(f)}>
            {busy === f ? "Making…" : label}
          </Button>
        ))}
        {csv && (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || busy !== null}
            onClick={() => {
              downloadCsv(csv.base, csv.text());
              onDone?.("txt");
            }}
          >
            {csv.label}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-700">Couldn&apos;t make the file. Try another format, or copy the report.</p>}
    </div>
  );
}
