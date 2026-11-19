import { z } from "zod";
import { handle, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { geocode, type GeocodeResult } from "@/lib/geocode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Small in-memory cache + global throttle to respect Nominatim's 1 req/s policy.
const cache = new Map<string, { at: number; results: GeocodeResult[] }>();
let lastUpstream = 0;

const querySchema = z.object({ q: z.string().trim().min(2).max(200) });

/** Address / postcode / place search. Used by admin forms and the public area form. */
export const GET = handle(async (request: Request) => {
  const { q } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  await enforceRateLimits(request, [{ name: "geocode:min", windowSeconds: 60, max: 20 }]);
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return json({ results: hit.results });

  const wait = lastUpstream + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastUpstream = Date.now();

  const results = await geocode(q);
  cache.set(key, { at: Date.now(), results });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return json({ results }, { headers: { "cache-control": "private, no-store" } });
});
