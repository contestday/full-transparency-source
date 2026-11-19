import { handle, json, requireBearer } from "@/lib/http";
import { optionalEnv } from "@/lib/env";
import { pollFollowMee } from "@/lib/jobs/poll-followmee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled FollowMee poll. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 * An external scheduler (Supabase pg_cron, cron-job.org, etc.) can call the same URL
 * with the same header for intervals Vercel's plan does not support.
 */
export const GET = handle(async (request: Request) => {
  requireBearer(request, optionalEnv("CRON_SECRET"));
  const summary = await pollFollowMee();
  return json(summary);
});
