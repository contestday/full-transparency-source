import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { VenuesManager, type Venue } from "./venues-manager";
import { SuggestedVenues, type SuggestedVenue } from "./suggested-venues";

export default async function AdminVenuesPage() {
  const { supabase } = await requirePageRole(["admin"]);
  const [{ data }, { data: suggested }] = await Promise.all([
    supabase.from("venues").select("id, name, category, address, lat, lng, public_area_label, is_public").order("name").limit(1000),
    supabase
      .from("venues")
      .select("id, name, category, address, public_area_label, metadata")
      .eq("metadata->>status", "pending")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Venues" description="Saved places for plans and history. Only venues you mark as public are shown by name." />
      <SuggestedVenues initial={(suggested ?? []) as SuggestedVenue[]} />
      <VenuesManager initial={(data ?? []) as Venue[]} />
    </div>
  );
}
