import { json } from "@/lib/http";
import { getStaffContext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is this browser signed in as staff? Used only to show the Admin link in the app. */
export async function GET() {
  const ctx = await getStaffContext().catch(() => null);
  return json({ staff: Boolean(ctx) }, { headers: { "cache-control": "private, no-store" } });
}
