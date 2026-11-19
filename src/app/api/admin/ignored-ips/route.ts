import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, json, parseJson } from "@/lib/http";
import { clientHash } from "@/lib/rate-limit";
import { ignoreIp, unignoreIp } from "@/lib/ignored-ips";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hash = z.string().regex(/^[a-f0-9]{8,80}$/);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ignore_me") }),
  z.object({ action: z.literal("ignore"), hash, label: z.string().trim().max(60).optional() }),
  z.object({ action: z.literal("unignore"), hash }),
]);

/** Leave an IP fingerprint out of Journeys and Senders (or bring it back). Admin only. */
export const POST = handle(async (request: Request) => {
  const { user, supabase } = await requireRole(["admin"]);
  const input = await parseJson(request, body);
  if (input.action === "ignore_me") {
    const when = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
    await ignoreIp(await clientHash(request), `My IP (added ${when})`);
  } else if (input.action === "ignore") await ignoreIp(input.hash, input.label || "Ignored IP");
  else await unignoreIp(input.hash);
  await auditStaff(supabase, user.id, { action: `ignored_ips.${input.action}`, resourceType: "ip_fingerprint" });
  return json({ ok: true });
});
