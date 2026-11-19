import { handle, json, requireBearer } from "@/lib/http";
import { optionalEnv } from "@/lib/env";
import { processPublication } from "@/lib/jobs/process-publication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handle(async (request: Request) => {
  requireBearer(request, optionalEnv("CRON_SECRET"));
  return json(await processPublication());
});
