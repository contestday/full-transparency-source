import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicSupabaseConfig, requireServerEnv } from "@/lib/env";

/**
 * Supabase client bound to the signed-in user's session (RLS applies).
 * Use for all administrator / reviewer reads and writes.
 */
export async function createUserClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const { url, anonKey } = publicSupabaseConfig();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component; the proxy refreshes sessions.
        }
      },
    },
  });
}

let serviceClient: SupabaseClient | null = null;

/**
 * Service-role client. BYPASSES RLS. Only use for:
 *   - reading the public_* views for public pages,
 *   - inserting validated anonymous submissions,
 *   - scheduled jobs (ingestion, publication).
 * Never import from client components (enforced by "server-only").
 */
export function createServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const { url } = publicSupabaseConfig();
  if (!url) requireServerEnv("NEXT_PUBLIC_SUPABASE_URL");
  serviceClient = createSupabaseClient(url, requireServerEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}
