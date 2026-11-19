"use client";

import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Notice } from "@/components/ui";
import { api } from "@/lib/client-api";
import { fmtDateTime } from "@/lib/format";
import { isOwnerDevice, markOwnerDevice, setOwnerDevice } from "@/lib/owner-device";

/** In the admin layout: this device is the owner's, so its visits are hidden on the Journeys report (still recorded). */
export function MarkOwnerDevice() {
  useEffect(() => markOwnerDevice(), []);
  return null;
}

const noSubscribe = () => () => undefined;

function ThisDevice() {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const quiet = useSyncExternalStore(noSubscribe, isOwnerDevice, () => null);
  const setQuiet = () => refresh();
  if (quiet == null) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      {quiet ? (
        <>
          <span className="font-semibold text-green-800">✓ This device is hidden</span>
          <span className="text-muted">(on any network)</span>
          <Button size="sm" variant="ghost" onClick={() => (setOwnerDevice(false), setQuiet())}>
            Show it again
          </Button>
        </>
      ) : (
        <>
          <span className="text-muted">This device shows like any visitor.</span>
          <Button size="sm" variant="secondary" onClick={() => (setOwnerDevice(true), setQuiet())}>
            Hide this device
          </Button>
        </>
      )}
    </p>
  );
}

async function send(json: unknown) {
  await api("/api/admin/ignored-ips", { method: "POST", json });
}

/** For an older visit with no IP fingerprint: hide just that visit (still recorded). */
export function HideVisitButton({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await send({ action: "hide_visit", visit_id: visitId });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      Hide this visit (mine)
    </Button>
  );
}

/** Bring back every visit hidden by hand. */
export function ShowHiddenVisits({ count }: { count: number }) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await send({ action: "show_visits" });
        router.refresh();
      }}
    >
      Show the {count} hidden by hand again
    </Button>
  );
}

/** "Ignore this IP" for one visit or sender. */
export function IgnoreIpButton({ hash, label }: { hash: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await send({ action: "ignore", hash, label });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      Ignore this IP
    </Button>
  );
}

/** Your current IP, and the list of ignored IPs (shared by Journeys and Senders). */
export function IgnoredIps({ list, currentHash }: { list: { hash: string; label: string; added_at: string }[]; currentHash: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const meIgnored = list.some((i) => i.hash === currentHash);

  async function post(json: unknown, ok: string) {
    setMsg(null);
    try {
      await send(json);
      setMsg({ tone: "green", text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Failed" });
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="font-semibold">Ignored IPs</h2>
          <p className="text-sm text-muted">
            Your own visits and submissions are still recorded like everyone&apos;s, just hidden from these two reports. Your IP can change
            (mobile data, Wi-Fi), so ignore it again when it does; devices that open admin are hidden whatever their IP. Only a scrambled
            fingerprint is kept, never the IP itself.
          </p>
        </div>
        {meIgnored ? (
          <span className="text-sm font-semibold text-green-800">✓ Your current IP is ignored</span>
        ) : (
          <Button onClick={() => post({ action: "ignore_me" }, "Your current IP is now ignored")}>Ignore my current IP</Button>
        )}
      </div>
      <ThisDevice />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {list.length > 0 && (
        <ul className="divide-y divide-hairline text-sm">
          {list.map((i) => (
            <li key={i.hash} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                {i.label}
                {i.hash === currentHash && <span className="ml-1 text-xs font-semibold text-green-800">(this device now)</span>}
                <span className="block font-mono text-xs text-muted">
                  …{i.hash.slice(-8)} · added {fmtDateTime(i.added_at)}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => post({ action: "unignore", hash: i.hash }, "Showing that IP again")}>
                Stop ignoring
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
