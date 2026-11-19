import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { numberEnv } from "@/lib/env";
import { LocationExplorer } from "../location-explorer";
import { loadMapContext } from "../map-context";

export default async function AdminHistoryPage() {
  const { supabase } = await requirePageRole(["admin"]);
  const [ctx, { data: batches }] = await Promise.all([
    loadMapContext(supabase),
    supabase.from("location_import_batches").select("id, source, file_name, created_at").neq("source", "followmee").order("created_at", { ascending: false }).limit(100),
  ]);
  return (
    <div>
      <PageHeader title="Complete location history" description="All private observations and derived visits, with filters and export." />
      <LocationExplorer mode="history" staleMinutes={numberEnv("STALE_AFTER_MINUTES", 30)} batches={batches ?? []} {...ctx} />
    </div>
  );
}
