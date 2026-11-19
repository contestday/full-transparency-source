import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { getSystemState, setSystemState } from "@/lib/ingest";
import { optionalEnv } from "@/lib/env";

/**
 * Contact alerts: when the GPS record shows I've entered an area set by an
 * anonymous watcher, email (a) the contacts that watcher chose and confirmed
 * (see watcher-contacts.ts) and (b) optionally my own list. Emails only;
 * nothing phones 999 or 101.
 */
export const contactSettingsSchema = z.object({
  /** My own list (Admin → Settings). */
  enabled: z.boolean(),
  emails: z.array(z.email().max(254)).max(10),
  /** Include the exact GPS position in each email. */
  include_position: z.boolean(),
  /** Safety cap so a busy day can't flood an inbox. */
  max_per_day: z.number().int().min(1).max(200),
  /** Let watchers send reports to contacts they choose (confirmed by the recipient). */
  allow_watcher_contacts: z.boolean().default(true),
});
export type ContactSettings = z.infer<typeof contactSettingsSchema>;

export const DEFAULT_CONTACT_SETTINGS: ContactSettings = {
  enabled: false,
  emails: [],
  include_position: true,
  max_per_day: 30,
  allow_watcher_contacts: true,
};
const KEY = "incident_contacts";
const SENT_KEY = "incident_contacts_sent";

export async function loadContactSettings(): Promise<ContactSettings> {
  const raw = await getSystemState<unknown>(KEY);
  const parsed = contactSettingsSchema.safeParse({ ...DEFAULT_CONTACT_SETTINGS, ...(raw as object | null) });
  return parsed.success ? parsed.data : DEFAULT_CONTACT_SETTINGS;
}

export async function saveContactSettings(s: ContactSettings) {
  await setSystemState(KEY, s);
}

/** True when the site can send email (Resend key and sender configured). */
export function emailConfigured(): boolean {
  return Boolean(optionalEnv("RESEND_API_KEY") && optionalEnv("NOTIFICATION_EMAIL_FROM"));
}

export interface AreaEntry {
  geofenceId: string;
  observedAt: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
}

interface FenceInfo {
  id: string;
  reference: string;
  shape_type: string;
  radius_m: number | null;
  description: string | null;
  watcher_id: string | null;
}

const MILE = 1609.344;
const distanceText = (m: number) => (m >= MILE ? `${Math.round((m / MILE) * 10) / 10} miles` : `${Math.round(m)} m`);

/** Plain, factual email text. Pure: exported for tests. */
export function composeAlert(
  fence: FenceInfo,
  entry: AreaEntry,
  opts: { includePosition: boolean; baseUrl: string; audience?: "owner" | "watcher"; stopUrl?: string },
) {
  const watcher = opts.audience === "watcher";
  const when = new Date(entry.observedAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "full", timeStyle: "short" });
  const firstLine = fence.description ? fence.description.split("\n")[0].slice(0, 120) : "";
  const what =
    fence.shape_type === "beyond_home"
      ? `an area set by an anonymous member of the public covering anywhere more than ${distanceText(fence.radius_m ?? 0)} from ${watcher ? "their" : "my"} home`
      : `an area set by an anonymous member of the public${firstLine ? ` ("${firstLine}")` : ""}`;
  const lines = watcher
    ? [
        "This is an automated report from Full Transparency, a site where one person publishes their own location record.",
        "You confirmed you wanted these reports when an anonymous watcher of the site added your address.",
        "",
        `At ${when} (UK time), the published person's GPS record shows they entered ${what}. Reference: ${fence.reference}.`,
      ]
    : [
        "This is an automated message from Full Transparency, sent at my own request.",
        "",
        `At ${when} (UK time), my GPS record shows I entered ${what}. Reference: ${fence.reference}.`,
      ];
  if (opts.includePosition) {
    const acc = entry.accuracyM != null ? ` (accuracy about ${Math.round(entry.accuracyM)} m)` : "";
    const lat = entry.lat.toFixed(5);
    const lng = entry.lng.toFixed(5);
    lines.push("", `GPS position: ${lat}, ${lng}${acc}`, `Map: https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`);
  }
  lines.push(
    "",
    "Please note: these areas are drawn by anonymous members of the public through the website. They are not court orders or bail conditions, and a GPS reading shows where the phone was, not who carried it.",
    "",
    `Published record: ${opts.baseUrl || "https://full-transparency.vercel.app"}`,
  );
  if (opts.stopUrl) lines.push("", `To stop these emails: ${opts.stopUrl}`);
  return { subject: `Full Transparency: GPS entry into watched area ${fence.reference}`, text: lines.join("\n") };
}

export async function sendMail(to: string[], subject: string, text: string) {
  const key = optionalEnv("RESEND_API_KEY");
  const from = optionalEnv("NOTIFICATION_EMAIL_FROM");
  if (!key || !from) throw new Error("Email isn't set up on this site yet");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Email send failed: HTTP ${res.status}`);
}

/** Email contacts about entries into watchers' areas (respecting daily caps). */
export async function sendContactAlerts(entries: AreaEntry[]): Promise<{ sent: number; skipped: number }> {
  if (!entries.length || !emailConfigured()) return { sent: 0, skipped: entries.length };
  const settings = await loadContactSettings();
  const { data: fences } = await createServiceClient()
    .from("geofences")
    .select("id, reference, shape_type, radius_m, description, watcher_id")
    .in("id", [...new Set(entries.map((e) => e.geofenceId))]);
  const byId = new Map(((fences ?? []) as FenceInfo[]).map((f) => [f.id, f]));
  const watcherIds = [...new Set([...byId.values()].map((f) => f.watcher_id).filter((w): w is string => Boolean(w)))];
  const { activeContactsFor, stopUrlFor } = await import("@/lib/watcher-contacts");
  const watcherContacts = settings.allow_watcher_contacts ? await activeContactsFor(watcherIds) : [];

  const today = new Date().toISOString().slice(0, 10);
  const state = (await getSystemState<{ day: string; counts?: Record<string, number> }>(SENT_KEY)) ?? { day: today };
  const counts: Record<string, number> = state.day === today && state.counts ? { ...state.counts } : {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  const baseUrl = optionalEnv("APP_BASE_URL") ?? "";
  let sent = 0;
  let skipped = 0;
  for (const e of entries) {
    const fence = byId.get(e.geofenceId);
    // Only areas set by watchers (anonymous members of the public).
    if (!fence?.watcher_id) {
      skipped++;
      continue;
    }
    // (a) That watcher's confirmed contacts, each email with its own stop link.
    const wKey = `w:${fence.watcher_id}`;
    for (const c of watcherContacts.filter((x) => x.watcher_id === fence.watcher_id)) {
      if ((counts[wKey] ?? 0) >= settings.max_per_day) break;
      const { subject, text } = composeAlert(fence, e, { includePosition: settings.include_position, baseUrl, audience: "watcher", stopUrl: stopUrlFor(c.id) });
      await sendMail([c.email], subject, text);
      sent++;
    }
    if (watcherContacts.some((x) => x.watcher_id === fence.watcher_id)) bump(wKey);
    // (b) My own list, if switched on.
    if (settings.enabled && settings.emails.length && (counts.owner ?? 0) < settings.max_per_day) {
      const { subject, text } = composeAlert(fence, e, { includePosition: settings.include_position, baseUrl });
      await sendMail(settings.emails, subject, text);
      bump("owner");
      sent++;
    }
  }
  await setSystemState(SENT_KEY, { day: today, counts });
  return { sent, skipped };
}

/** A clearly labelled test message to the chosen contacts. */
export async function sendTestContactEmail(emails: string[]) {
  await sendMail(
    emails,
    "Full Transparency: test of automatic area alerts",
    "This is a test. When switched on, Full Transparency emails this address each time my GPS record shows I've entered an area set by an anonymous member of the public. No action is needed.",
  );
}
