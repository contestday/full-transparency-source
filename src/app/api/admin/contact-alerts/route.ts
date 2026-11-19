import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, json, parseJson } from "@/lib/http";
import { auditStaff } from "@/lib/audit";
import { contactSettingsSchema, loadContactSettings, saveContactSettings, sendTestContactEmail } from "@/lib/incident-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Contact alerts settings (admin only). */
export const GET = handle(async () => {
  await requireRole(["admin"]);
  return json({ settings: await loadContactSettings() });
});

export const PUT = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const settings = await parseJson(request, contactSettingsSchema);
  await saveContactSettings(settings);
  await auditStaff(supabase, user.id, {
    action: "contact_alerts.updated",
    resourceType: "settings",
    resourceId: "incident_contacts",
    metadata: { enabled: settings.enabled, recipients: settings.emails.length, include_position: settings.include_position, max_per_day: settings.max_per_day },
  });
  return json({ settings });
});

/** Send a clearly labelled test email to the given addresses. */
export const POST = handle(async (request: Request) => {
  await requireRole(["admin"]);
  const { emails } = await parseJson(request, z.object({ emails: z.array(z.email()).min(1).max(10) }));
  await sendTestContactEmail(emails);
  return json({ ok: true });
});
