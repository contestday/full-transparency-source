import { z } from "zod";
import { handle, json, parseJson } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import { requestCountry } from "@/lib/submission-guard";
import { redactAnalyticsUrl } from "@/lib/analytics-redact";
import { automatedKind } from "@/lib/automated-visit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  visit_id: z.string().regex(/^[A-Za-z0-9]{8,40}$/),
  /** Sent by a device that has opened the admin area. */
  own: z.boolean().optional(),
  /** navigator.webdriver: a test browser. */
  auto: z.boolean().optional(),
  events: z
    .array(
      z.object({
        kind: z.enum(["page", "tap", "error"]),
        path: z.string().max(500),
        detail: z.string().max(300).optional(),
        at: z.number().int(),
      }),
    )
    .min(1)
    .max(40),
});

/**
 * Anonymous journey log: steps through the public site for one visit (a
 * random ID made fresh each visit, no cookie). No IP address is stored: only
 * the country Vercel reports and the same scrambled IP fingerprint used for
 * rate limiting. Every visit is recorded, the owner's
 * included; the owner's own devices and automated visits (Vercel's checks, test
 * browsers, bots) are tagged so the Journeys report can hide them. Private links are removed again here, and
 * admin/sign-in pages are never recorded. Kept for 30 days.
 */
export const POST = handle(async (request: Request) => {
  const ipHash = await enforceRateLimits(request, [{ name: "events:min", windowSeconds: 60, max: 120 }]);
  const input = await parseJson(request, body);
  const country = requestCountry(request);
  const now = Date.now();
  const automated = automatedKind(request.headers.get("user-agent"), input.auto === true);
  const rows = input.events.flatMap((e) => {
    const url = redactAnalyticsUrl(new URL(e.path, "https://x.invalid").toString());
    if (!url) return [];
    const u = new URL(url);
    // Clamp times to the last day (a phone's clock may be off).
    const at = Math.min(now, Math.max(now - 86_400_000, e.at));
    return [
      {
        visit_id: input.visit_id,
        at: new Date(at).toISOString(),
        kind: e.kind,
        path: (u.pathname + u.search).slice(0, 300),
        detail: e.detail?.replace(/[A-Z0-9]{24}/g, "[link]").slice(0, 300) ?? null,
        country,
        ip_hash: ipHash,
        owner_device: input.own === true,
        automated,
      },
    ];
  });
  if (rows.length) await createServiceClient().from("site_events").insert(rows);
  return json({ ok: true }, { status: 202 });
});
