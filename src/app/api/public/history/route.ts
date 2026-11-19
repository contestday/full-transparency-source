import { z } from "zod";
import { handle, json } from "@/lib/http";
import { getPublicHistory } from "@/lib/public-data";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const GET = handle(async (request: Request) => {
  const p = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const to = p.to ?? new Date().toISOString().slice(0, 10);
  const from = p.from ?? new Date(Date.parse(to) - 7 * 86_400_000).toISOString().slice(0, 10);
  // Cap range to 92 days per request.
  const fromMs = Math.max(Date.parse(from), Date.parse(to) - 92 * 86_400_000);
  const result = await getPublicHistory(new Date(fromMs).toISOString(), `${to}T23:59:59.999Z`);
  return json(result, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } });
});
