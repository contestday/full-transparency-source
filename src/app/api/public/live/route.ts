import { handle, json } from "@/lib/http";
import { getPublicLiveStatus } from "@/lib/public-data";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const status = await getPublicLiveStatus();
  return json(status, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=30" } });
});
