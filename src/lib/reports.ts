import { z } from "zod";

/** Neutral topics for the Contact page. */
export const REPORT_CATEGORIES = {
  question: "A question",
  plans: "About a plan or where I'll be",
  inaccuracy: "Something on the site looks wrong",
  watch: "Help with a watch link",
  feedback: "Feedback or a suggestion",
  privacy: "Privacy",
  other: "Something else",
} as const;

export const REPORT_STATUSES = ["new", "under_review", "awaiting_information", "closed", "flagged_abuse"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  new: "New",
  under_review: "Under review",
  awaiting_information: "Awaiting information",
  closed: "Closed",
  flagged_abuse: "Flagged for abuse",
};

export const ATTACHMENT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const,
};

/** Magic-number check so the declared MIME type cannot be spoofed. */
export function sniffMime(bytes: Uint8Array): (typeof ATTACHMENT_LIMITS.mimeTypes)[number] | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return "image/webp";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d)
    return "application/pdf";
  return null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const reportSchema = z.object({
  category: z.enum(Object.keys(REPORT_CATEGORIES) as [string, ...string[]]),
  incident_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  incident_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  general_location: optionalText(300),
  description: z.string().trim().min(10, "Please describe the concern (at least 10 characters)").max(5000),
  contact_info: optionalText(300),
  related_geofence_reference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^FT-G-[A-Z0-9]{4}-[A-Z0-9]{4}$/, "Reference should look like FT-G-XXXX-XXXX")
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  website: z.string().max(0).optional().default(""),
  form_started_at: z.coerce.number().int(),
});

export type ReportInput = z.infer<typeof reportSchema>;

/** Combine optional date and time into an ISO timestamp (UK local time interpreted as Europe/London is out of scope; stored as UTC with an approximate flag). */
export function incidentTimestamp(date: string | null, time: string | null): string | null {
  if (!date) return null;
  const iso = `${date}T${time ?? "12:00"}:00Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
