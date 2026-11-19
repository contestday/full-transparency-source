import { z } from "zod";
import { handle, HttpError, json, parseJson } from "@/lib/http";
import { enforceRateLimits } from "@/lib/rate-limit";
import { findWatcher } from "@/lib/watchers";
import { addContact, listContacts, removeContact } from "@/lib/watcher-contacts";
import { emailConfigured, loadContactSettings } from "@/lib/incident-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

async function watcherOr404(ctx: Ctx) {
  const { token } = await ctx.params;
  const w = await findWatcher(token.toUpperCase());
  if (!w || w.status !== "active") throw new HttpError(404, "This watch link is not valid or has been revoked");
  return w;
}

/** A watcher's report contacts (only they can see them, with their link). */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const w = await watcherOr404(ctx);
  const settings = await loadContactSettings();
  return json({ available: settings.allow_watcher_contacts && emailConfigured(), contacts: await listContacts(w.id) });
});

/** Add a contact: they get a confirmation email and receive nothing else until they confirm. */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  await enforceRateLimits(request, [
    { name: "watch-contact:hour", windowSeconds: 3600, max: 5 },
    { name: "watch-contact:day", windowSeconds: 86400, max: 10 },
  ]);
  const w = await watcherOr404(ctx);
  const settings = await loadContactSettings();
  if (!settings.allow_watcher_contacts || !emailConfigured()) throw new HttpError(422, "Automatic reports aren't available at the moment");
  const { email } = await parseJson(request, z.object({ email: z.email().max(254) }));
  try {
    return json({ contact: await addContact(w.id, email) }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && /already|Up to/.test(e.message)) throw new HttpError(422, e.message);
    throw e;
  }
});

export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const w = await watcherOr404(ctx);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Contact not found");
  await removeContact(w.id, id);
  return json({ ok: true });
});
