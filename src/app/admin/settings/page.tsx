import { requirePageRole } from "@/lib/auth";
import { Badge, Card, PageHeader } from "@/components/ui";
import { optionalEnv } from "@/lib/env";
import type { PublicationRuleRow } from "@/lib/publication";
import { PublicationSettings } from "./publication-settings";
import { NotificationSettings } from "./notification-settings";
import { SampleWatcherSettings } from "./sample-watcher-settings";
import { UserSettings } from "./user-settings";
import { LiveMarkerSettings } from "./live-marker-settings";
import { ContactAlertSettings } from "./contact-alert-settings";
import { PasswordSettings } from "./password-settings";
import { PoliceReportsToggle } from "./police-reports-toggle";
import { countWatcherPoliceReports, policeReportsEnabled } from "@/lib/police-reports";
import { emailConfigured, loadContactSettings } from "@/lib/incident-contacts";
import type { LiveStatus } from "@/lib/live-status";

export default async function AdminSettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const breached = (await searchParams).password === "breached";
  const { supabase, user } = await requirePageRole(["admin"]);
  const [{ data: rules }, { data: users }, { data: live }] = await Promise.all([
    supabase.from("publication_rules").select("*").order("rule_type").order("updated_at"),
    supabase.from("profiles").select("id, email, role, created_at").order("created_at"),
    supabase.from("live_status").select("status").eq("id", 1).maybeSingle(),
  ]);
  const integrations: [string, boolean][] = [
    ["FollowMee (FOLLOWMEE_API_KEY / USERNAME / DEVICE_ID)", Boolean(optionalEnv("FOLLOWMEE_API_KEY") && optionalEnv("FOLLOWMEE_USERNAME") && optionalEnv("FOLLOWMEE_DEVICE_ID"))],
    ["Cron secret (CRON_SECRET)", Boolean(optionalEnv("CRON_SECRET"))],
    ["Ingest API secret (GPS_INGEST_SECRET)", Boolean(optionalEnv("GPS_INGEST_SECRET"))],
    ["Web Push (VAPID keys)", Boolean(optionalEnv("VAPID_PUBLIC_KEY") && optionalEnv("VAPID_PRIVATE_KEY") && optionalEnv("VAPID_SUBJECT"))],
    ["Email fallback (RESEND_API_KEY / NOTIFICATION_EMAIL_FROM)", Boolean(optionalEnv("RESEND_API_KEY") && optionalEnv("NOTIFICATION_EMAIL_FROM"))],
    ["Rate-limit salt (RATE_LIMIT_SALT)", Boolean(optionalEnv("RATE_LIMIT_SALT"))],
  ];
  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Integrations, privacy, publication and access." />
      <PoliceReportsToggle initial={await policeReportsEnabled()} watchersOn={await countWatcherPoliceReports().catch(() => 0)} />
      {breached && <PasswordSettings breached />}
      <Card>
        <h2 className="mb-2 font-semibold">Integrations</h2>
        <ul className="space-y-1 text-sm">
          {integrations.map(([label, ok]) => (
            <li key={label} className="flex items-center justify-between gap-2">
              <span>{label}</span>
              <Badge tone={ok ? "green" : "amber"}>{ok ? "Configured" : "Not configured"}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Secrets are set as Vercel environment variables. See docs/DEPLOYMENT.md.</p>
      </Card>
      <LiveMarkerSettings rules={(rules ?? []) as (PublicationRuleRow & { id: string })[]} currentStatus={((live?.status as LiveStatus) ?? "unknown")} />
      <PublicationSettings
        key={(rules ?? []).map((r) => `${r.id}:${r.updated_at}:${r.enabled}`).join("|")}
        initialRules={(rules ?? []) as (PublicationRuleRow & { id: string })[]}
      />
      <SampleWatcherSettings />
      <NotificationSettings vapidPublicKey={optionalEnv("VAPID_PUBLIC_KEY") ?? null} />
      <ContactAlertSettings initial={await loadContactSettings()} emailReady={emailConfigured()} />
      <UserSettings users={users ?? []} currentUserId={user.id} />
      {!breached && <PasswordSettings breached={false} />}
    </div>
  );
}
