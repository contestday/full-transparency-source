import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { createServiceClient } from "@/lib/supabase/server";
import { loadSubmissionRules } from "@/lib/submission-guard";
import { SendersManager, type Sender } from "./senders-manager";

export const dynamic = "force-dynamic";

/**
 * Who has submitted areas or notes: country and an anonymous fingerprint of
 * the IP address only. Never the areas themselves (private areas stay private).
 */
export default async function SendersPage() {
  await requirePageRole(["admin"]);
  const db = createServiceClient();
  const since = new Date(new Date().getTime() - 90 * 86_400_000).toISOString();
  const [{ data: fences }, { data: reports }, { data: blocked }, rules] = await Promise.all([
    db
      .from("geofences")
      .select("reference, tier, submitted_at, submitter_hash, submitter_country")
      .eq("origin", "anonymous")
      .gte("submitted_at", since)
      .limit(2000),
    db.from("incident_reports").select("created_at, submitter_hash, submitter_country").gte("created_at", since).limit(2000),
    db.from("blocked_submitters").select("submitter_hash, country, reason, created_at"),
    loadSubmissionRules(),
  ]);
  const by = new Map<string, Sender>();
  const get = (hash: string) => {
    let s = by.get(hash);
    if (!s) {
      s = { hash, countries: [], areas: { wide: 0, local: 0, location: 0 }, notes: 0, wideRefs: [], last: "", blocked: false };
      by.set(hash, s);
    }
    return s;
  };
  type FenceRow = { reference: string; tier: "wide" | "local" | "location" | null; submitted_at: string; submitter_hash: string | null; submitter_country: string | null };
  for (const f of (fences ?? []) as FenceRow[]) {
    if (!f.submitter_hash) continue;
    const s = get(f.submitter_hash);
    if (f.tier) s.areas[f.tier]++;
    if (f.tier === "wide" || f.tier === "local") s.wideRefs.push(f.reference);
    if (f.submitter_country && !s.countries.includes(f.submitter_country)) s.countries.push(f.submitter_country);
    if (f.submitted_at > s.last) s.last = f.submitted_at;
  }
  type ReportRow = { created_at: string; submitter_hash: string | null; submitter_country: string | null };
  for (const r of (reports ?? []) as ReportRow[]) {
    if (!r.submitter_hash) continue;
    const s = get(r.submitter_hash);
    s.notes++;
    if (r.submitter_country && !s.countries.includes(r.submitter_country)) s.countries.push(r.submitter_country);
    if (r.created_at > s.last) s.last = r.created_at;
  }
  const blockedSet = new Set((blocked ?? []).map((b) => b.submitter_hash as string));
  for (const s of by.values()) s.blocked = blockedSet.has(s.hash);
  const senders = [...by.values()].sort((a, b) => b.last.localeCompare(a.last));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Senders"
        description="Who has submitted areas or notes in the last 90 days: country and an anonymous fingerprint of their IP address only. Private areas' contents are never shown."
      />
      <SendersManager
        senders={senders}
        blocked={(blocked ?? []) as { submitter_hash: string; country: string | null; reason: string | null; created_at: string }[]}
        allowedCountries={rules.allowed_countries}
      />
    </div>
  );
}
