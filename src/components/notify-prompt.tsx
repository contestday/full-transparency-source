"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui";
import { Icon } from "@/components/design";
import { loadWatchLinks } from "@/lib/watch-links";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "checking" | "unsupported" | "ask" | "blocked" | "on" | "error";

/** Where this device's subscription is saved. */
function saveUrl(target: "watch" | "admin", token: string | null) {
  return target === "admin" ? "/api/admin/notifications/subscribe" : `/api/watch/${token}/push`;
}

async function saveSubscription(target: "watch" | "admin", token: string | null, sub: PushSubscription) {
  const json = sub.toJSON();
  const body = target === "admin" ? { channel: "web_push", endpoint: json.endpoint, keys: json.keys } : { endpoint: json.endpoint, keys: json.keys };
  const res = await fetch(saveUrl(target, token), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error ?? "Could not turn on notifications");
  }
}

/**
 * A clear "Turn on notifications" bar. Shown until this device is signed up;
 * once permission is given, the subscription is re-saved quietly on each visit
 * so the server always has it.
 *
 * target "watch": for a watch link (`token`, or the one saved on this device).
 * target "admin": the owner's own alerts.
 */
export function NotifyPrompt({ vapidPublicKey, target, token: givenToken, compact = false }: { vapidPublicKey: string | null; target: "watch" | "admin"; token?: string; compact?: boolean }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(givenToken ?? null);
  const path = usePathname();

  useEffect(() => {
    let t = givenToken ?? null;
    if (target === "watch" && !t) t = loadWatchLinks()[0]?.token ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(t);
    if (!vapidPublicKey || (target === "watch" && !t)) return setState("unsupported");
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("blocked");
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (Notification.permission === "granted" && sub) {
          await saveSubscription(target, t, sub).catch(() => undefined);
          setState("on");
        } else setState("ask");
      } catch {
        setState("ask");
      }
    })();
  }, [vapidPublicKey, target, givenToken]);

  const turnOn = useCallback(async () => {
    setError(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState(Notification.permission === "denied" ? "blocked" : "ask");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!) }));
      await saveSubscription(target, token, sub);
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn on notifications");
      setState("error");
    }
  }, [target, token, vapidPublicKey]);

  if (state === "checking" || state === "unsupported" || state === "on") return null;
  // A watch page shows its own prompt for its own link.
  if (target === "watch" && !givenToken && (path?.startsWith("/watch/") || path === "/sample")) return null;

  const what = target === "admin" ? "alerts about the site (new areas, reports, status changes)" : "an alert when I enter or leave your areas";
  return (
    <div role="region" aria-label="Notifications" className={compact ? "border-b border-[#F5C86B] bg-[#FFF4D6]" : "rounded-[var(--ft-radius-card)] border-2 border-[#F5C86B] bg-[#FFF4D6]"}>
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3 px-4 py-3 text-sm text-[#142B49]">
        <Icon name="bell" className="h-6 w-6 shrink-0" />
        <span className="min-w-0 flex-1 basis-56">
          {state === "blocked" ? (
            <>
              <strong>Notifications are blocked on this device.</strong> To get {what}, open the site&apos;s settings (the icon
              left of the address, or in the installed app: ⋮ → App info → Notifications) and allow notifications, then reload.
            </>
          ) : (
            <>
              <strong>Turn on notifications</strong> to get {what} on this device.
              {error && <span className="block text-red-700">{error}</span>}
            </>
          )}
        </span>
        {state !== "blocked" && (
          <Button type="button" variant="primary" onClick={turnOn}>
            Turn on notifications
          </Button>
        )}
      </div>
    </div>
  );
}
