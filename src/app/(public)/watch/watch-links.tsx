"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { forgetWatchLink, loadWatchLinks, saveWatchLink, tokenFromInput, type SavedWatchLink } from "@/lib/watch-links";
import { fmtDateTime } from "@/lib/format";

type Info = { valid: false } | { valid: true; display_code: string | null; areas: number; is_sample: boolean };

/**
 * The watch links saved on this device. The first one is the one this
 * device uses (watched history, card colours, notifications). Each can be
 * opened, made the one used here, or removed from this device (removing
 * doesn't delete the link: it still works wherever else it's saved).
 */
export function WatchLinks({ manage = false }: { manage?: boolean }) {
  const router = useRouter();
  const [links, setLinks] = useState<SavedWatchLink[]>([]);
  const [info, setInfo] = useState<Record<string, Info>>({});
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(!manage);

  const refresh = useCallback(() => setLinks(loadWatchLinks()), []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Already watching on this phone: go straight to that link's page.
  useEffect(() => {
    if (manage) return;
    const first = loadWatchLinks()[0]?.token;
    if (!first) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpening(false);
      return;
    }
    fetch(`/api/watch/${first}/info`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { valid: false }))
      .then((i: Info) => {
        if (i.valid && !i.is_sample) router.replace(`/watch/${first}${location.search.includes("alert=1") ? "?alert=1" : ""}`);
        else setOpening(false);
      })
      .catch(() => setOpening(false));
  }, [manage, router]);

  useEffect(() => {
    let cancelled = false;
    for (const l of links) {
      if (info[l.token]) continue;
      fetch(`/api/watch/${l.token}/info`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { valid: false }))
        .then((i: Info) => {
          if (cancelled) return;
          if (i.valid && i.is_sample) {
            // The public sample was saved here by mistake: it isn't anyone's own link.
            forgetWatchLink(l.token);
            refresh();
            return;
          }
          setInfo((m) => ({ ...m, [l.token]: i }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [links, info, refresh]);

  function add(e: FormEvent) {
    e.preventDefault();
    const t = tokenFromInput(input);
    if (!t) return setError("That doesn't look like a watch link. Paste the whole link, or the 24-character code at the end of it.");
    setError(null);
    router.push(`/watch/${t}`);
  }

  if (opening) return <p className="text-sm text-muted">Opening your geofences…</p>;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4 sm:p-6">
        <h2 className="text-xl font-bold">Saved on this phone</h2>
        {links.length > 1 && <p className="text-sm text-muted">The first one is used on this phone for watched history, card colours and notifications.</p>}
        {links.length ? (
          <ul className="space-y-3">
            {links.map((l, i) => {
              const inf = info[l.token];
              return (
                <li key={l.token} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {inf?.valid ? `Watcher #${inf.display_code ?? "?"}` : inf ? "No longer valid" : "Checking…"}
                    </span>
                    {inf?.valid && <span className="text-sm text-muted">{inf.areas} area{inf.areas === 1 ? "" : "s"}</span>}
                    {i === 0 && inf?.valid && <Badge tone="green">Used on this phone</Badge>}
                  </div>
                  <p className="text-xs text-muted">
                    Link ending …{l.token.slice(-6)} · saved {fmtDateTime(l.savedAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {inf?.valid !== false && (
                      <Link href={`/watch/${l.token}`} className="inline-flex h-9 items-center rounded-[var(--ft-radius-control)] bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-hover">
                        Open and edit areas
                      </Link>
                    )}
                    {i > 0 && inf?.valid && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          saveWatchLink(l.token);
                          refresh();
                        }}
                      >
                        Use on this phone
                      </Button>
                    )}
                    <ConfirmButton
                      prompt="Remove from this phone?"
                      confirmLabel="Remove"
                      onConfirm={() => {
                        forgetWatchLink(l.token);
                        refresh();
                      }}
                    >
                      Remove from this phone
                    </ConfirmButton>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            None on this phone yet. Add one below, or <Link className="text-accent underline" href="/geofences/submit">watch an area</Link> to get one.
          </p>
        )}
        <p className="text-xs text-muted">
          Removing a link only removes it from this phone; it still works anywhere else you&apos;ve kept it. To delete an area, open the link
          and use Remove on that area.
        </p>
      </Card>

      <Card className="space-y-3 p-4 sm:p-6">
        <h2 className="text-xl font-bold">Add a watch link you already have</h2>
        <p className="text-sm text-muted">Paste the whole link (from your email, notes or a QR code), or just the 24-character code at the end of it.</p>
        <form className="flex flex-wrap gap-2" onSubmit={add}>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your watch link or code"
            aria-label="Watch link or code"
            className="min-w-0 flex-1 basis-56"
            autoCapitalize="characters"
            autoComplete="off"
          />
          <Button type="submit">Add and open</Button>
        </form>
        {error && <Notice tone="red">{error}</Notice>}
      </Card>
    </div>
  );
}
