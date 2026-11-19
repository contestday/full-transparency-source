import { z } from "zod";
import { handle, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { reverseAddress } from "@/lib/geocode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cache + one upstream request a second (OpenStreetMap's Nominatim policy).
const cache = new Map<string, string | null>();
let lastUpstream = 0;
const schema = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

/** The address of a published stay (see fullAddressFrom: no house numbers except public places). */
export const GET = handle(async (request: Request) => {
  const { lat, lng } = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return json({ address: cache.get(key) }, { headers: { "cache-control": "public, max-age=86400" } });
  await enforceRateLimits(request, [{ name: "address:min", windowSeconds: 60, max: 40 }]);
  const wait = lastUpstream + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastUpstream = Date.now();
  const address = await reverseAddress(lat, lng);
  cache.set(key, address);
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return json({ address }, { headers: { "cache-control": "public, max-age=86400" } });
});
