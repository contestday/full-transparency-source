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

interface Stored {
  list: IgnoredIp[];
  /** Single visits hidden by hand (older visits recorded before fingerprints, 19 Nov 2026). */
  visits: string[];
}

async function load(): Promise<Stored> {
  const { data } = await createServiceClient().from("system_state").select("value").eq("key", KEY).maybeSingle();
  const v = (data?.value ?? {}) as Partial<Stored>;
  return {
    list: Array.isArray(v.list) ? v.list.filter((i) => typeof i?.hash === "string") : [],
    visits: Array.isArray(v.visits) ? v.visits.filter((x) => typeof x === "string") : [],
  };
}

export async function loadIgnoredIps(): Promise<IgnoredIp[]> {
  return (await load()).list;
}

export async function loadHiddenVisits(): Promise<string[]> {
  return (await load()).visits;
}

async function store(next: Partial<Stored>) {
  const value = { ...(await load()), ...next };
  const { error } = await createServiceClient()
    .from("system_state")
    .upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}

const save = (list: IgnoredIp[]) => store({ list });

export async function hideVisit(visitId: string) {
  const { visits } = await load();
  if (!visits.includes(visitId)) await store({ visits: [...visits, visitId].slice(-2000) });
}

export async function showHiddenVisits() {
  await store({ visits: [] });
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
