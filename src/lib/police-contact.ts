import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * The extra police contact the owner may have set (a force that 101 doesn't
 * reach). Kept only in the database (system_state "local_police"), so no
 * force or place is ever named in the code.
 */
export interface PoliceContact {
  label: string;
  tel: string;
  web: string | null;
}

export async function loadPoliceContact(): Promise<PoliceContact | null> {
  const { data } = await createServiceClient().from("system_state").select("value").eq("key", "local_police").maybeSingle();
  const v = data?.value as Partial<PoliceContact> | null;
  if (!v?.label || !v.tel || !/^\+?[0-9]{3,15}$/.test(v.tel)) return null;
  return { label: v.label, tel: v.tel, web: typeof v.web === "string" && /^https:\/\//.test(v.web) ? v.web : null };
}
