import { z } from "zod";
import { handle, json } from "@/lib/http";
import { getPublicPlans } from "@/lib/public-data";
import { PLAN_STATUSES } from "@/lib/plans";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  category: z.string().max(50).optional(),
  status: z.enum(PLAN_STATUSES).optional(),
});

export const GET = handle(async (request: Request) => {
  const p = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const plans = await getPublicPlans({
    from: p.from ? `${p.from}T00:00:00Z` : undefined,
    to: p.to ? `${p.to}T23:59:59.999Z` : undefined,
    category: p.category,
    status: p.status,
  });
  return json({ plans }, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } });
});
