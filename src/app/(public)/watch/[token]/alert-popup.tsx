"use client";

import { useEffect, useState } from "react";
import { alertText, type AlertEvent } from "@/lib/alert-text";
import { fmtTime } from "@/lib/format";

interface Alert {
  id: number;
  event: AlertEvent;
  tier: string | null;
  outside: boolean;
  reference: string;
  since: string | null;
  created_at: string;
}

/**
 * Shows the latest alerts as a popup when the watch page is opened (from a
 * notification, or any time there are alerts this device hasn't seen yet).
 * Closing it shows the live map; the reminder schedule can be changed right
 * here.
 */
export function AlertPopup({
  token,
  ownerName,
  ownerFirst,
  areaNames,
  sample,
  reminders,
  onReminders,
  onClose,
}: {
  token: string;
  ownerName: string;
  ownerFirst: string;
  areaNames: Record<string, string>;
  sample: boolean;
  reminders?: { want: number; location: number };
  onReminders?: (kind: "want" | "location", minutes: number) => void;
  onClose: () => void;
}) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [open, setOpen] = useState(false);
  const seenKey = `ft-alert-seen:${token.slice(-8)}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/watch/${token}/alerts`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((b: { alerts: Alert[] }) => {
        if (cancelled) return;
        let seen = 0;
        try {
          seen = Number(localStorage.getItem(seenKey) ?? 0);
        } catch {
          /* no storage */
        }
        const fromNotification = new URLSearchParams(location.search).get("alert") === "1";
        const list = b.alerts ?? [];
        setAlerts(list);
        setOpen(list.length > 0 && (fromNotification || list[0].id > seen));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, seenKey]);

  function close() {
    try {
      if (alerts?.[0]) localStorage.setItem(seenKey, String(alerts[0].id));
    } catch {
      /* no storage */
    }
    setOpen(false);
    onClose();
  }

  if (!open || !alerts?.length) return null;
  const shown = alerts.slice(0, 3);
  return (
    <div data-sample-ok role="dialog" aria-modal="true" aria-labelledby="alert-title" className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-3 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="alert-title" className="text-xl font-bold">
          {sample ? "Sample alert" : "Your latest alert"}
          {shown.length > 1 ? "s" : ""}
        </h2>
        {sample && <p className="rounded-lg bg-[#FFE7A3] p-2 text-sm font-bold">From the public sample, not your own watch list.</p>}
        <ul className="space-y-3">
          {shown.map((a) => {
            const t = alertText({
              ownerName,
              ownerFirst,
              event: a.event,
              tier: a.tier,
              outside: a.outside,
              areaName: areaNames[a.reference] ?? null,
              reference: a.reference,
              since: a.since,
              sample,
            });
            return (
              <li key={a.id} className="rounded-xl border border-border p-3 text-sm">
                <p className="font-semibold">
                  {fmtTime(a.created_at)} · {t.title.replace(/^SAMPLE ALERT, not your watch list\. /, "")}
                </p>
                <p className="mt-1 text-muted">{t.body}</p>
              </li>
            );
          })}
        </ul>
        {!sample && reminders && onReminders && (
          <div className="space-y-2 rounded-xl bg-[#F7FAFD] p-3 text-sm">
            <p className="font-semibold">How often should I remind you while {ownerFirst} is still there?</p>
            {(
              [
                ["want", "In a Want area (red)", reminders.want],
                ["location", "At a Location (purple)", reminders.location],
              ] as const
            ).map(([kind, label, value]) => (
              <label key={kind} className="flex flex-wrap items-center justify-between gap-2">
                <span>{label}</span>
                <select className="h-10 rounded-lg border border-border bg-white px-2" value={value} onChange={(e) => onReminders(kind, Number(e.target.value))}>
                  <option value={10}>every 10 minutes</option>
                  <option value={20}>every 20 minutes</option>
                  <option value={30}>every 30 minutes</option>
                  <option value={60}>every hour</option>
                  <option value={0}>not at all</option>
                </select>
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={close}
          className="h-12 w-full rounded-[var(--ft-radius-control)] bg-accent font-semibold text-white hover:bg-accent-hover"
        >
          Close and show the live map
        </button>
      </div>
    </div>
  );
}
