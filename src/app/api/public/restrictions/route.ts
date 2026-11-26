import { handle, json } from "@/lib/http";
import { loadOwnerAreas, loadOwnerEvents } from "@/lib/events/server";
import { loadOwnerProfile } from "@/lib/watchers";
import { loadOwnerActivities } from "@/lib/activities-server";

export const dynamic = "force-dynamic";

/**
 * Where I mustn't go, for everyone: my own areas and the events I'm banned
 * from, and the activities I'm banned from. If I break my own restrictions, everyone needs to be able to see it.
 */
export const GET = handle(async () => {
  const [areas, events, owner, activities] = await Promise.all([loadOwnerAreas(), loadOwnerEvents(), loadOwnerProfile(), loadOwnerActivities()]);
  return json(
    {
      owner_first: owner.first,
      areas,
      events: events.map((e) => ({ ...e, id: undefined, watcher_id: undefined })),
      activities,
    },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
});
