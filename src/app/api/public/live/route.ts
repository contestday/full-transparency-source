import { handle, json } from "@/lib/http";
import { getPublicLiveStatus } from "@/lib/public-data";
import { loadHomeArea } from "@/lib/home";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const [status, home_area] = await Promise.all([getPublicLiveStatus(), loadHomeArea().catch(() => null)]);
  return json({ ...status, home_area }, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=30" } });
});
