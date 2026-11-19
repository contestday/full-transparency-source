"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/design";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Anyone can get the public sample's real alerts on their phone, to see how
 * alerts work. Clearly marked as the sample, and easy to turn off here or from
 * the notification itself.
 */
export function SampleAlerts({ token, vapidPublicKey }: { token: string; vapidPublicKey: string | null }) {
  const [state, setState] = useState<"checking" | "off" | "on" | "blocked" | "unsupported">("checking");
  const [msg, setMsg] = useState<string | null>(null);

  const endpointNow = useCallback(async () => {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return { reg, sub: await reg.pushManager.getSubscription() };
  }, []);

  useEffect(() => {
    if (!vapidPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") return setState("blocked");
    endpointNow()
      .then(async ({ sub }) => {
        if (!sub) return setState("off");
        const r = await fetch(`/api/watch/${token}/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { cache: "no-store" });
        setState(r.ok && (await r.json()).subscribed ? "on" : "off");
      })
      .catch(() => setState("off"));
  }, [token, vapidPublicKey, endpointNow]);

  async function turnOn() {
    setMsg(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState(Notification.permission === "denied" ? "blocked" : "off");
      const { reg, sub: existing } = await endpointNow();
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!) }));
      const json = sub.toJSON();
      const r = await fetch(`/api/watch/${token}/push`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not turn on sample alerts");
      setState("on");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not turn on sample alerts");
    }
  }

  async function turnOff() {
    setMsg(null);
    try {
      const { sub } = await endpointNow();
      if (sub) await fetch(`/api/watch/${token}/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
      setState("off");
    } catch {
      setMsg("Could not turn sample alerts off. Please try again.");
    }
  }

  if (state === "checking" || state === "unsupported") return null;
  return (
    <div data-sample-ok id="sample-alerts" className="rounded-[var(--ft-radius-card)] border-2 border-[#B45309] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <Icon name="bell" className="mt-0.5 h-6 w-6 shrink-0 text-[#B45309]" />
        <div className="min-w-0 flex-1 basis-60 space-y-1">
          <p className="text-lg font-bold">{state === "on" ? "Sample alerts are on for this phone" : "Get the sample's real alerts on this phone"}</p>
          <p className="text-sm text-muted">
            See exactly what a watcher receives: real alerts, as they happen, for this sample&apos;s areas. Every one is clearly marked
            <strong> SAMPLE</strong>, so it can&apos;t be mistaken for your own watch list. Turn them off here, or with the button on any
            sample alert.
          </p>
          {state === "blocked" && <p className="text-sm text-red-700">Notifications are blocked for this site in your browser settings.</p>}
          {msg && <p className="text-sm text-red-700">{msg}</p>}
        </div>
        {state === "on" ? (
          <button type="button" onClick={turnOff} className="h-11 rounded-[var(--ft-radius-control)] border border-border px-4 font-semibold hover:bg-sky">
            Turn off sample alerts
          </button>
        ) : state === "off" ? (
          <button type="button" onClick={turnOn} className="h-11 rounded-[var(--ft-radius-control)] bg-[#B45309] px-4 font-semibold text-white hover:brightness-95">
            Turn on sample alerts
          </button>
        ) : null}
      </div>
    </div>
  );
}
