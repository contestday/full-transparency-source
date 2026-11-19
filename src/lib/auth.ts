import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { HttpError } from "@/lib/http";

export type Role = "none" | "reviewer" | "admin";

export interface StaffContext {
  supabase: SupabaseClient;
  user: User;
  role: Role;
}

export async function getStaffContext(): Promise<StaffContext | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = (profile?.role as Role | undefined) ?? "none";
  return { supabase, user, role };
}

/** For API route handlers. Throws HttpError(401/403). */
export async function requireRole(allowed: Role[] = ["admin"]): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) throw new HttpError(401, "Authentication required");
  if (!allowed.includes(ctx.role)) throw new HttpError(403, "Insufficient permissions");
  return ctx;
}

/** For server components / pages. Redirects instead of throwing. */
export async function requirePageRole(allowed: Role[] = ["admin"]): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/login");
  if (!allowed.includes(ctx.role)) redirect("/login?error=forbidden");
  return ctx;
}
