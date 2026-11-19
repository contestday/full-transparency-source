import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { numberEnv } from "@/lib/env";
import { LocationExplorer } from "../location-explorer";
import { loadMapContext } from "../map-context";
import { Artwork } from "@/components/brand";

export default async function AdminMapPage() {
  const { supabase } = await requirePageRole(["admin"]);
  const ctx = await loadMapContext(supabase);
  return (
    <div>
      <Artwork stem="geofence" sizes="(min-width: 1280px) 1280px, 100vw" className="mb-4 h-28 w-full rounded-[var(--ft-radius-card)] object-cover sm:h-36" />
      <PageHeader title="Private GPS map" description="Live view. Refreshes every minute. Never shown publicly." />
      <LocationExplorer mode="live" staleMinutes={numberEnv("STALE_AFTER_MINUTES", 30)} {...ctx} />
    </div>
  );
}
