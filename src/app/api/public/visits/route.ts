import { z } from "zod";
import { handle, json } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { getPublicHistory, type PublicHistoryRecord } from "@/lib/public-data";
import { haversineMeters } from "@/lib/geo";
import { ALL_TIME_FROM } from "@/lib/history-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All published stays (a few thousand), kept for five minutes.
let stays: { at: number; records: PublicHistoryRecord[] } | null = null;
async function allStays() {
  if (stays && Date.now() - stays.at < 5 * 60_000) return stays.records;
  const h = await getPublicHistory(`${ALL_TIME_FROM}T00:00:00Z`, new Date().toISOString(), { stopsOnly: true });
  stays = { at: Date.now(), records: h.records };
  return h.records;
}

const schema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  name: z.string().max(200).optional(),
  cell: z.coerce.number().min(0).max(5000).optional(),
});

/** Every published stay at the same place (same public place name, or the same spot), newest first. */
export const GET = handle(async (request: Request) => {
  await enforceRateLimits(request, [{ name: "public-visits:min", windowSeconds: 60, max: 30 }]);
  const { lat, lng, name, cell } = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const near = Math.max(75, (cell ?? 0) / 2);
  const same = (await allStays()).filter((r) =>
    name && r.venue_name ? r.venue_name.toLowerCase() === name.toLowerCase() && haversineMeters({ lat, lng }, { lat: r.public_lat, lng: r.public_lng }) < 2000 : haversineMeters({ lat, lng }, { lat: r.public_lat, lng: r.public_lng }) <= near,
  );
  const visits = same
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at))
    .slice(0, 300)
    .map((r) => ({ id: r.id, from: r.observed_at, until: r.observed_until }));
  return json({ count: same.length, visits }, { headers: { "cache-control": "public, s-maxage=300" } });
});
