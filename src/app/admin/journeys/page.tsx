import Link from "next/link";
import { requirePageRole } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { createServiceClient } from "@/lib/supabase/server";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { currentIpHash, loadHiddenVisits, loadIgnoredIps } from "@/lib/ignored-ips";
import { HideVisitButton, IgnoredIps, IgnoreIpButton, ShowHiddenVisits } from "../ignore-ip";

export const dynamic = "force-dynamic";

interface Ev {
  visit_id: string;
  at: string;
  kind: "page" | "tap" | "error";
  path: string | null;
  detail: string | null;
  country: string | null;
  ip_hash: string | null;
  owner_device: boolean | null;
  automated: string | null;
}

const flag = (cc: string | null) => (cc ? `${String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))} ${cc}` : "—");
const RANGES = [
  { key: "1", label: "Last 24 hours" },
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
];

/**
 * Anonymous journeys through the public site: each visit as a timeline, where
 * visits end, and the error messages people saw. No names, no IP addresses;
 * visits can't be linked to each other.
 */
export default async function JourneysPage({ searchParams }: PageProps<"/admin/journeys">) {
  await requirePageRole(["admin"]);
  const sp = await searchParams;
  const days = RANGES.some((r) => r.key === sp.days) ? Number(sp.days) : 1;
  const since = new Date(new Date().getTime() - days * 86_400_000).toISOString();
  const [{ data }, ignored, myHash, hiddenByHand] = await Promise.all([
    createServiceClient()
      .from("site_events")
      .select("visit_id, at, kind, path, detail, country, ip_hash, owner_device, automated")
      .gte("at", since)
      .order("at", { ascending: true })
      .limit(20000),
    loadIgnoredIps(),
    currentIpHash(),
    loadHiddenVisits(),
  ]);
  const byHand = new Set(hiddenByHand);
  const skip = new Set(ignored.map((i) => i.hash));
  const all = (data ?? []) as Ev[];
  // Your own visits and automated checks are recorded, just hidden here.
  const autoVisits = new Set(all.filter((e) => e.automated).map((e) => e.visit_id));
  const mineVisits = new Set(all.filter((e) => !autoVisits.has(e.visit_id) && (byHand.has(e.visit_id) || e.owner_device || (e.ip_hash && skip.has(e.ip_hash)))).map((e) => e.visit_id));
  const hiddenVisits = new Set([...autoVisits, ...mineVisits]);
  const events = all.filter((e) => !hiddenVisits.has(e.visit_id));

  const visits = new Map<string, Ev[]>();
  for (const e of events) visits.set(e.visit_id, [...(visits.get(e.visit_id) ?? []), e]);
  const list = [...visits.entries()].map(([id, evs]) => ({ id, evs, start: evs[0].at, end: evs[evs.length - 1].at }));
  list.sort((a, b) => b.start.localeCompare(a.start));

  const count = <K extends string>(keys: K[]) => {
    const m = new Map<K, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  };
  const exits = count(list.map((v) => [...v.evs].reverse().find((e) => e.kind === "page")?.path ?? "—"));
  const errors = count(events.filter((e) => e.kind === "error").map((e) => `${e.detail ?? ""}  (${e.path})`));
  const pages = count(events.filter((e) => e.kind === "page").map((e) => (e.path ?? "—").split("?")[0]));
  const mins = (v: { start: string; end: string }) => Math.round((Date.parse(v.end) - Date.parse(v.start)) / 60_000);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Journeys"
        description="Anonymous visits to the public site: pages, taps and error messages, with times. No names or IP addresses (only a scrambled fingerprint); each visit has a random ID that changes every visit. Kept for 30 days."
      />
      <IgnoredIps list={ignored} currentHash={myHash} />
      {hiddenVisits.size > 0 && (
        <p className="text-xs text-muted">
          Hidden here (still recorded): {mineVisits.size} visit{mineVisits.size === 1 ? "" : "s"} of yours · {autoVisits.size} automated check
          {autoVisits.size === 1 ? "" : "s"} (Vercel, test browsers, bots).{" "}
          {byHand.size > 0 && <ShowHiddenVisits count={byHand.size} />}
        </p>
      )}
      <div className="flex flex-wrap gap-2 text-sm">
        {RANGES.map((r) => (
          <Link
            key={r.key}
            href={`/admin/journeys?days=${r.key}`}
            className={`rounded-full border px-3 py-1.5 font-semibold ${String(days) === r.key ? "border-ink bg-ink text-white" : "border-border bg-white"}`}
          >
            {r.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-3xl font-bold tabular-nums">{list.length}</p>
          <p className="text-sm text-muted">visits</p>
        </Card>
        <Card className="p-4">
          <p className="text-3xl font-bold tabular-nums">{events.filter((e) => e.kind === "page").length}</p>
          <p className="text-sm text-muted">pages viewed</p>
        </Card>
        <Card className="p-4">
          <p className="text-3xl font-bold tabular-nums">{events.filter((e) => e.kind === "error").length}</p>
          <p className="text-sm text-muted">error messages shown</p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="space-y-2 p-4">
          <h2 className="font-semibold">Where visits end</h2>
          <Table rows={exits} empty="No visits yet." />
        </Card>
        <Card className="space-y-2 p-4">
          <h2 className="font-semibold">Errors people saw</h2>
          <Table rows={errors} empty="No errors. 🎉" />
        </Card>
        <Card className="space-y-2 p-4">
          <h2 className="font-semibold">Most viewed pages</h2>
          <Table rows={pages} empty="No pages yet." />
        </Card>
      </div>

      <Card className="space-y-2 p-4">
        <h2 className="font-semibold">Visits ({list.length}, newest first)</h2>
        {!list.length && <p className="text-sm text-muted">Nothing recorded in this period yet.</p>}
        <ul className="divide-y divide-hairline">
          {list.slice(0, 200).map((v) => (
            <li key={v.id} className="py-2">
              <details>
                <summary className="cursor-pointer text-sm">
                  <span className="font-semibold tabular-nums">{fmtDateTime(v.start)}</span> · {flag(v.evs[0].country)} ·{" "}
                  {v.evs.filter((e) => e.kind === "page").length} pages · {mins(v)} min
                  {v.evs.some((e) => e.kind === "error") && <span className="ml-1 font-semibold text-red-700">· error</span>}
                  <span className="block truncate text-xs text-muted">
                    {v.evs
                      .filter((e) => e.kind === "page")
                      .map((e) => (e.path ?? "").split("?")[0])
                      .join(" → ")}
                  </span>
                </summary>
                {(() => {
                  const h = v.evs.find((e) => e.ip_hash)?.ip_hash;
                  return h ? (
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                      <span className="font-mono">IP …{h.slice(-8)}</span>
                      <IgnoreIpButton hash={h} label={`Visit ${fmtDateTime(v.start)}`} />
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>Recorded before IP fingerprints (19 Nov 2026).</span>
                      <HideVisitButton visitId={v.id} />
                    </div>
                  );
                })()}
                <ol className="mt-2 space-y-1 border-l-2 border-hairline pl-3 text-xs">
                  {v.evs.map((e, i) => (
                    <li key={i} className={e.kind === "error" ? "text-red-700" : e.kind === "page" ? "font-semibold" : "text-muted"}>
                      <span className="tabular-nums">{fmtTime(e.at)}</span> {e.kind === "page" ? `Page ${e.path}` : e.kind === "tap" ? `Tapped “${e.detail}”` : `Error: ${e.detail}`}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Table({ rows, empty }: { rows: [string, number][]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-1 text-sm">
      {rows.map(([k, n]) => (
        <li key={k} className="flex gap-2">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{k}</span>
          <span className="font-semibold tabular-nums">{n}</span>
        </li>
      ))}
    </ul>
  );
}
