import "server-only";
import { sendNotification, setVapidDetails } from "web-push";
import { createServiceClient } from "@/lib/supabase/server";
import { optionalEnv } from "@/lib/env";

export type NotificationEvent =
  | "geofence_submitted"
  | "geofence_enter"
  | "geofence_exit"
  | "geofence_reminder"
  | "geofence_changed"
  | "report_submitted"
  | "ingestion_failure"
  | "ingestion_stale"
  | "import_failure"
  | "publication_failure"
  | "live_status_changed"
  | "plan_outcome_needed"
  | "plan_wish"
  | "test";

export interface NotificationMessage {
  event: NotificationEvent;
  title: string;
  body: string;
  /** Relative admin URL to open. Never include coordinates. */
  url?: string;
}

let vapidConfigured: boolean | null = null;
function configureVapid(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;
  const pub = optionalEnv("VAPID_PUBLIC_KEY") ?? optionalEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const priv = optionalEnv("VAPID_PRIVATE_KEY");
  const subject = optionalEnv("VAPID_SUBJECT");
  vapidConfigured = Boolean(pub && priv && subject);
  if (vapidConfigured) setVapidDetails(subject!, pub!, priv!);
  return vapidConfigured;
}

/** Guard: notification text must never carry raw coordinates. */
export function containsCoordinates(text: string): boolean {
  return /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(text);
}

/**
 * Deliver a notification to every enabled administrator subscription.
 * Never throws: delivery results are persisted to notification_deliveries.
 */
export async function notifyAdmins(msg: NotificationMessage): Promise<{ sent: number; failed: number }> {
  if (containsCoordinates(msg.title) || containsCoordinates(msg.body)) {
    console.error("Refusing to send notification containing coordinates", msg.event);
    return { sent: 0, failed: 1 };
  }
  const supabase = createServiceClient();
  let sent = 0;
  let failed = 0;
  try {
    // Only subscriptions belonging to current admins.
    const { data: admins } = await supabase.from("profiles").select("id").eq("role", "admin");
    const adminIds = (admins ?? []).map((a) => a.id);
    if (!adminIds.length) return { sent, failed };
    const { data: subs, error } = await supabase
      .from("notification_subscriptions")
      .select("id, channel, endpoint, keys")
      .eq("enabled", true)
      .in("owner_id", adminIds);
    if (error) throw error;

    const deliveries: Record<string, unknown>[] = [];
    for (const sub of subs ?? []) {
      let status: "sent" | "failed" | "skipped" = "sent";
      let errorText: string | null = null;
      try {
        if (sub.channel === "web_push") {
          if (!configureVapid()) {
            status = "skipped";
            errorText = "VAPID keys not configured";
          } else {
            await sendNotification(
              { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
              JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? "/admin" }),
              { TTL: 3600, urgency: msg.event.startsWith("geofence") ? "high" : "normal" },
            );
          }
        } else if (sub.channel === "email") {
          const ok = await sendEmail(sub.endpoint, msg);
          if (!ok) {
            status = "skipped";
            errorText = "Email provider not configured";
          }
        }
      } catch (err: unknown) {
        status = "failed";
        errorText = err instanceof Error ? err.message : String(err);
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired — disable it.
          await supabase.from("notification_subscriptions").update({ enabled: false }).eq("id", sub.id);
        }
      }
      if (status === "sent") sent++;
      else failed++;
      deliveries.push({
        subscription_id: sub.id,
        event_type: msg.event,
        title: msg.title,
        status,
        error: errorText,
      });
    }
    if (!deliveries.length) {
      deliveries.push({ event_type: msg.event, title: msg.title, status: "skipped", error: "No subscriptions" });
    }
    await supabase.from("notification_deliveries").insert(deliveries);
  } catch (err) {
    console.error("notifyAdmins failed", err);
    failed++;
  }
  return { sent, failed };
}

/** Optional email fallback via Resend's HTTP API. Returns false if not configured. */
async function sendEmail(to: string, msg: NotificationMessage): Promise<boolean> {
  const key = optionalEnv("RESEND_API_KEY");
  const from = optionalEnv("NOTIFICATION_EMAIL_FROM");
  if (!key || !from) return false;
  const base = optionalEnv("APP_BASE_URL") ?? "";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: `[Full Transparency] ${msg.title}`,
      text: `${msg.body}\n\n${base}${msg.url ?? "/admin"}`,
    }),
  });
  if (!res.ok) throw new Error(`Email send failed: HTTP ${res.status}`);
  return true;
}
