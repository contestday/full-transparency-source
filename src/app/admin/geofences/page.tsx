import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { GeofenceManager, type AdminFence, type LegalRestriction } from "./geofence-manager";

export default async function AdminGeofencesPage() {
  const { supabase, role } = await requirePageRole(["admin", "reviewer"]);
  const [{ data: fences }, { data: events }, { data: restrictions }] = await Promise.all([
    supabase.from("geofences_geojson").select("*").order("submitted_at", { ascending: false }).limit(500),
    role === "admin"
      ? supabase
          .from("geofence_events")
          // Watchers' Locations are private to them: Wish and Want areas and mine only.
          .select("id, geofence_id, event_type, observed_at, accuracy_m, geofences!inner(tier)")
          .or("tier.is.null,tier.in.(wide,local)", { referencedTable: "geofences" })
          .order("observed_at", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] }),
    role === "admin" ? supabase.from("legal_restrictions").select("*").order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  return (
    <div>
      <PageHeader
        title="Geofences"
        description="Anonymous areas of concern appear here immediately. They are unverified expressions of concern, not legal restrictions."
      />
      <GeofenceManager
        isAdmin={role === "admin"}
        initialFences={(fences ?? []) as AdminFence[]}
        events={(events ?? []) as { id: string; geofence_id: string; event_type: string; observed_at: string; accuracy_m: number | null }[]}
        restrictions={(restrictions ?? []) as LegalRestriction[]}
      />
    </div>
  );
}
