"use client";

/**
 * A finished report as a file the reporter keeps: Word (.doc), plain text
 * (.txt) or PDF. Made on their own device; nothing is sent anywhere.
 */
export type ReportFormat = "doc" | "txt" | "pdf";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A heading line in the report text: in capitals (anything in brackets after it may not be). */
const isHeading = (line: string) => {
  const head = line.split("(")[0];
  return /[A-Z]{2}/.test(head) && head === head.toUpperCase() && !head.includes(":");
};

function fileName(base: string, ext: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const safe =
    base
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "report";
  return `${safe}-${day}.${ext}`;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Word opens an HTML file saved as .doc; headings stay bold. */
function docBlob(title: string, text: string, html?: string): Blob {
  const body =
    html ??
    text
      .split("\n")
      .map((l) => (l.trim() === "" ? "<p>&nbsp;</p>" : isHeading(l) ? `<p><b>${esc(l)}</b></p>` : `<p>${esc(l)}</p>`))
      .join("");
  const page = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;font-size:11pt}p{margin:0 0 4pt}table{border-collapse:collapse}td,th{border:1px solid #999;padding:3pt;text-align:left;vertical-align:top}</style></head><body>${body}</body></html>`;
  return new Blob(["\ufeff", page], { type: "application/msword" });
}

async function pdfBlob(text: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 18;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const bottom = pdf.internal.pageSize.getHeight() - margin;
  const lineH = 5;
  let y = margin;
  pdf.setFontSize(10.5);
  for (const raw of text.split("\n")) {
    const heading = isHeading(raw);
    pdf.setFont("helvetica", heading ? "bold" : "normal");
    if (heading && y > margin) y += 2;
    const wrapped: string[] = raw.trim() === "" ? [""] : pdf.splitTextToSize(raw, width);
    for (const l of wrapped) {
      if (y + lineH > bottom) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(l, margin, y);
      y += lineH;
    }
  }
  const pages = pdf.getNumberOfPages();
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.text(`Page ${i} of ${pages}`, margin, pdf.internal.pageSize.getHeight() - 8);
  }
  return pdf.output("blob");
}

/**
 * Save the report. `html` (optional) is a richer body for the Word file,
 * such as the evidence pack's tables; the text is used otherwise.
 */
export async function downloadReport(format: ReportFormat, opts: { title: string; base: string; text: string; html?: string }): Promise<void> {
  if (format === "txt")
    return save(
      new Blob(["\ufeff", opts.text.replace(/\n/g, "\r\n")], {
        type: "text/plain;charset=utf-8",
      }),
      fileName(opts.base, "txt"),
    );
  if (format === "doc") return save(docBlob(opts.title, opts.text, opts.html), fileName(opts.base, "doc"));
  return save(await pdfBlob(opts.text), fileName(opts.base, "pdf"));
}

/** Save a CSV file (opens in Excel or any spreadsheet). */
export function downloadCsv(base: string, csv: string): void {
  save(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }), fileName(base, "csv").replace(/-\d{4}-\d{2}-\d{2}\.csv$/, ".csv"));
}
