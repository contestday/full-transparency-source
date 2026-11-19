import "server-only";
import { createHmac } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { randomCode, sha256Hex } from "@/lib/crypto";
import { optionalEnv } from "@/lib/env";
import { sendMail } from "@/lib/incident-contacts";

/**
 * Contacts a watcher chooses for automatic reports (e.g. a police contact).
 * Double opt-in: an address gets alerts only after its owner follows the
 * confirmation link, so nobody can use this site to email a stranger.
 */
export const MAX_CONTACTS_PER_WATCHER = 5;

const base = () => optionalEnv("APP_BASE_URL") ?? "https://full-transparency.vercel.app";

/** Stop links are derived (not stored), so each alert can carry one. */
export function stopTokenFor(contactId: string): string {
  const secret = optionalEnv("RATE_LIMIT_SALT") ?? optionalEnv("CRON_SECRET") ?? "ft";
  return createHmac("sha256", secret).update(`stop:${contactId}`).digest("base64url").slice(0, 32);
}
export const stopUrlFor = (contactId: string) => `${base()}/contacts/stop?t=${stopTokenFor(contactId)}`;

export interface WatcherContact {
  id: string;
  email: string;
  confirmed: boolean;
  stopped: boolean;
}

export async function listContacts(watcherId: string): Promise<WatcherContact[]> {
  const { data, error } = await createServiceClient()
    .from("watcher_contacts")
    .select("id, email, confirmed_at, stopped_at")
    .eq("watcher_id", watcherId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id, email: c.email, confirmed: Boolean(c.confirmed_at), stopped: Boolean(c.stopped_at) }));
}

export async function addContact(watcherId: string, emailRaw: string): Promise<WatcherContact> {
  const email = emailRaw.trim().toLowerCase();
  const supabase = createServiceClient();
  const existing = await listContacts(watcherId);
  if (existing.some((c) => c.email === email)) throw new Error("That address is already on your list");
  if (existing.length >= MAX_CONTACTS_PER_WATCHER) throw new Error(`Up to ${MAX_CONTACTS_PER_WATCHER} contacts per watch link`);

  const confirmToken = randomCode(32);
  const id = crypto.randomUUID();
  const { error } = await supabase.from("watcher_contacts").insert({
    id,
    watcher_id: watcherId,
    email,
    confirm_token_hash: await sha256Hex(confirmToken),
    stop_token_hash: await sha256Hex(stopTokenFor(id)),
  });
  if (error) throw error;
  await sendMail(
    [email],
    "Please confirm: automatic reports from Full Transparency",
    [
      "Someone watching Full Transparency (a public location-transparency site, published by the person it tracks) has asked for automatic emails to this address.",
      "",
      "If you confirm, you'll get a short factual email each time that person's GPS record shows them entering an area the watcher has chosen.",
      "",
      `To confirm, open this link and press Confirm: ${base()}/contacts/confirm?t=${confirmToken}`,
      "",
      "If you weren't expecting this, ignore this email: nothing more will be sent.",
    ].join("\n"),
  );
  return { id, email, confirmed: false, stopped: false };
}

export async function removeContact(watcherId: string, contactId: string) {
  const { error } = await createServiceClient().from("watcher_contacts").delete().eq("id", contactId).eq("watcher_id", watcherId);
  if (error) throw error;
}

export async function confirmContact(token: string): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from("watcher_contacts")
    .update({ confirmed_at: new Date().toISOString(), stopped_at: null })
    .eq("confirm_token_hash", await sha256Hex(token))
    .select("id");
  if (error) throw error;
  return Boolean(data?.length);
}

export async function stopContact(token: string): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from("watcher_contacts")
    .update({ stopped_at: new Date().toISOString() })
    .eq("stop_token_hash", await sha256Hex(token))
    .select("id");
  if (error) throw error;
  return Boolean(data?.length);
}

/** Confirmed, not-stopped contacts for these watchers. */
export async function activeContactsFor(watcherIds: string[]): Promise<{ id: string; watcher_id: string; email: string }[]> {
  if (!watcherIds.length) return [];
  const { data, error } = await createServiceClient()
    .from("watcher_contacts")
    .select("id, watcher_id, email")
    .in("watcher_id", watcherIds)
    .not("confirmed_at", "is", null)
    .is("stopped_at", null);
  if (error) {
    if (/watcher_contacts/.test(error.message)) return []; // migration 0013 not applied yet
    throw error;
  }
  return data ?? [];
}
