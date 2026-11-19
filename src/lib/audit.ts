import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Audit an action performed by a signed-in staff member (RLS-checked insert). */
export async function auditStaff(supabase: SupabaseClient, actorId: string, input: AuditInput) {
  const { error } = await supabase.from("audit_events").insert({
    actor_id: actorId,
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) console.error("audit insert failed", error);
}

/** Audit a system or anonymous action (service role). */
export async function auditSystem(actorLabel: "system" | "anonymous" | "cron", input: AuditInput) {
  const { error } = await createServiceClient()
    .from("audit_events")
    .insert({
      actor_label: actorLabel,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      metadata: input.metadata ?? {},
    });
  if (error) console.error("audit insert failed", error);
}
