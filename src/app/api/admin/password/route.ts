import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { auditStaff } from "@/lib/audit";
import { BREACHED_MESSAGE, MIN_PASSWORD_LENGTH, isPwnedPassword } from "@/lib/pwned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = ["admin", "reviewer"] as const;

/** After sign-in: is the password just used found in a known breach? (Nothing is stored.) */
export const POST = handle(async (request: Request) => {
  await requireRole([...ROLES]);
  await enforceRateLimits(request, [{ name: "pw-check:hour", windowSeconds: 3600, max: 20 }]);
  const { password } = await parseJson(request, z.object({ password: z.string().min(1).max(200) }));
  return json({ breached: (await isPwnedPassword(password)) === true });
});

/** Change my password: refused if too short or found in a known breach. */
export const PUT = handle(async (request: Request) => {
  const { supabase, user } = await requireRole([...ROLES]);
  await enforceRateLimits(request, [{ name: "pw-change:hour", windowSeconds: 3600, max: 10 }]);
  const { password } = await parseJson(request, z.object({ password: z.string().max(200) }));
  if (password.length < MIN_PASSWORD_LENGTH) throw new HttpError(422, `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  const pwned = await isPwnedPassword(password);
  if (pwned === true) throw new HttpError(422, BREACHED_MESSAGE);
  if (pwned === null) console.warn("password change: breach check unavailable; allowed");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new HttpError(422, error.message);
  await auditStaff(supabase, user.id, { action: "password.changed", resourceType: "user", resourceId: user.id, metadata: { breach_check: pwned === null ? "unavailable" : "passed" } });
  return json({ ok: true, checked: pwned !== null });
});
