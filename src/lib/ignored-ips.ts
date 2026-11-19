import "server-only";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { clientHash } from "@/lib/rate-limit";

/**
 * IP fingerprints the owner wants left out of Journeys and Senders (their own
 * phone, home broadband…). Only the salted one-way hash is kept, never the IP.
 * An IP can change, so the owner can ignore their current one again at any time.
 */
export interface IgnoredIp {
  hash: string;
  label: string;
  added_at: string;
}

const KEY = "ignored_ips";

export async function loadIgnoredIps(): Promise<IgnoredIp[]> {
  const { data } = await createServiceClient().from("system_state").select("value").eq("key", KEY).maybeSingle();
  const list = (data?.value as { list?: IgnoredIp[] } | null)?.list;
  return Array.isArray(list) ? list.filter((i) => typeof i?.hash === "string") : [];
}

async function save(list: IgnoredIp[]) {
  await createServiceClient()
    .from("system_state")
    .upsert({ key: KEY, value: { list }, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export async function ignoreIp(hash: string, label: string) {
  const list = await loadIgnoredIps();
  if (list.some((i) => i.hash === hash)) return;
  await save([...list, { hash, label: label.slice(0, 60), added_at: new Date().toISOString() }].slice(-50));
}

export async function unignoreIp(hash: string) {
  await save((await loadIgnoredIps()).filter((i) => i.hash !== hash));
}

/** Fingerprint of the IP viewing this page (for "Ignore my current IP"). */
export async function currentIpHash(): Promise<string> {
  return clientHash(new Request("https://x.invalid", { headers: await headers() }));
}
