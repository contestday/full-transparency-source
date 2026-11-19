import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";

/**
 * Who may submit. Each request is identified only by a salted one-way hash of
 * its IP address (from rate limiting) and the country Vercel reports for it.
 * The owner can block a sender's hash, or accept submissions only from chosen
 * countries. Raw IP addresses are never stored.
 */

/** Two-letter country of the request (Vercel header), or null (e.g. running locally). */
export function requestCountry(request: Request): string | null {
  const c = request.headers.get("x-vercel-ip-country")?.trim().toUpperCase();
  return c && /^[A-Z]{2}$/.test(c) ? c : null;
}

export interface SubmissionRules {
  /** Empty = any country. Otherwise only these (e.g. ["GB", "IE"]). */
  allowed_countries: string[];
}

const RULES_KEY = "submission_rules";

export async function loadSubmissionRules(): Promise<SubmissionRules> {
  const { data } = await createServiceClient().from("system_state").select("value").eq("key", RULES_KEY).maybeSingle();
  const v = (data?.value ?? {}) as Partial<SubmissionRules>;
  return { allowed_countries: Array.isArray(v.allowed_countries) ? v.allowed_countries.filter((c) => /^[A-Z]{2}$/.test(c)) : [] };
}

export async function saveSubmissionRules(rules: SubmissionRules) {
  await createServiceClient()
    .from("system_state")
    .upsert({ key: RULES_KEY, value: rules, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export const NOT_ACCEPTED = "Sorry, submissions can't be accepted from here.";

/** Refuse blocked senders and countries outside the allowed list. */
export async function assertSenderAllowed(submitterHash: string, country: string | null): Promise<void> {
  const supabase = createServiceClient();
  const [{ data: blocked }, rules] = await Promise.all([
    supabase.from("blocked_submitters").select("submitter_hash").eq("submitter_hash", submitterHash).maybeSingle(),
    loadSubmissionRules(),
  ]);
  if (blocked) throw new HttpError(403, NOT_ACCEPTED);
  if (country && rules.allowed_countries.length && !rules.allowed_countries.includes(country)) throw new HttpError(403, NOT_ACCEPTED);
}
