"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Notice } from "@/components/ui";
import { api } from "@/lib/client-api";
import { fmtDateTime } from "@/lib/format";
import { IgnoreIpButton } from "../ignore-ip";

export interface Sender {
  hash: string;
  countries: string[];
  areas: { wide: number; local: number; location: number };
  notes: number;
  wideRefs: string[];
  last: string;
  blocked: boolean;
}

const flag = (cc: string) => String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export function SendersManager({
  senders,
  blocked,
  allowedCountries,
}: {
  senders: Sender[];
  blocked: { submitter_hash: string; country: string | null; reason: string | null; created_at: string }[];
  allowedCountries: string[];
}) {
  const router = useRouter();
  const [countries, setCountries] = useState(allowedCountries.join(", "));
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function post(json: unknown, ok: string) {
    setMsg(null);
    try {
      await api("/api/admin/senders", { method: "POST", json });
      setMsg({ tone: "green", text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Failed" });
    }
  }

  return (
    <div className="space-y-4">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Card className="space-y-3 p-5">
        <h2 className="text-lg font-semibold">Allowed countries</h2>
        <p className="text-sm text-muted">
          Leave empty to accept submissions from anywhere, or list two-letter codes such as <strong>GB, IE</strong>. Everyone else
          is told &ldquo;Sorry, submissions can&apos;t be accepted from here.&rdquo;
        </p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const list = countries
              .toUpperCase()
              .split(/[\s,]+/)
              .filter((c) => /^[A-Z]{2}$/.test(c));
            void post({ action: "countries", allowed_countries: list }, list.length ? `Only accepting: ${list.join(", ")}` : "Accepting submissions from anywhere");
          }}
        >
          <Input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="Any country" className="min-w-0 flex-1 basis-48" aria-label="Allowed countries" />
          <Button type="submit">Save</Button>
        </form>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-lg font-semibold">Recent senders</h2>
        {!senders.length && <p className="text-sm text-muted">No submissions in the last 90 days.</p>}
        <ul className="divide-y divide-hairline">
          {senders.map((s) => (
            <li key={s.hash} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
              <div className="min-w-0 flex-1 basis-64">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {s.countries.length ? s.countries.map((c) => `${flag(c)} ${c}`).join(", ") : "Country not recorded"}
                  <span className="font-mono text-xs font-normal text-muted">sender …{s.hash.slice(-8)}</span>
                  {s.blocked && <Badge tone="red">Blocked</Badge>}
                </p>
                <p className="text-muted">
                  {s.areas.wide} Wish · {s.areas.local} Want · {s.areas.location} Location{s.areas.location === 1 ? "" : "s"} · {s.notes}{" "}
                  note{s.notes === 1 ? "" : "s"} · last {fmtDateTime(s.last)}
                </p>
                {s.wideRefs.length > 0 && <p className="text-xs text-muted">Wish/Want areas: {s.wideRefs.slice(0, 6).join(", ")}</p>}
              </div>
              <IgnoreIpButton hash={s.hash} label={`Sender ${s.countries[0] ?? ""} (last ${fmtDateTime(s.last)})`.replace("  ", " ")} />
              {s.blocked ? (
                <Button size="sm" variant="secondary" onClick={() => post({ action: "unblock", submitter_hash: s.hash }, "Unblocked")}>
                  Unblock
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => post({ action: "block", submitter_hash: s.hash, country: s.countries[0] ?? null }, "Blocked: future submissions from this sender are refused")}
                >
                  Block sender
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          Blocking refuses any future area, change or note from that IP address. It doesn&apos;t remove what they already added: withdraw
          their Wish and Want areas under Geofences.
        </p>
      </Card>

      {blocked.length > 0 && (
        <Card className="space-y-2 p-5">
          <h2 className="text-lg font-semibold">Blocked senders ({blocked.length})</h2>
          <ul className="space-y-1 text-sm">
            {blocked.map((b) => (
              <li key={b.submitter_hash} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">…{b.submitter_hash.slice(-8)}</span>
                {b.country && (
                  <span>
                    {flag(b.country)} {b.country}
                  </span>
                )}
                <span className="text-muted">since {fmtDateTime(b.created_at)}</span>
                <Button size="sm" variant="ghost" onClick={() => post({ action: "unblock", submitter_hash: b.submitter_hash }, "Unblocked")}>
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
