"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/design";
import { loadWatchLinks } from "@/lib/watch-links";

const SNOOZE_KEY = "ft-sample-prompt-snoozed-until";
const SNOOZE_DAYS = 7;

/** Is this phone already getting the sample's alerts? (Only if it has a push subscription.) */
async function getsSampleAlerts(sampleToken: string): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return false;
  const r = await fetch(`/api/watch/${sampleToken}/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { cache: "no-store" });
  return r.ok && Boolean((await r.json()).subscribed);
}

/**
 * The homepage invitation to try the sample's alerts. Not shown when this
 * phone already gets them, when it has its own watch link (the invitation is
 * then only on the sample page), or for 7 days after "Not now".
 */
export function SampleAlertsPrompt({ sampleToken }: { sampleToken: string | null }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sampleToken) return;
      try {
        if (Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now()) return;
      } catch {
        /* storage unavailable: show it */
      }
      if (loadWatchLinks().length > 0) return;
      if (await getsSampleAlerts(sampleToken).catch(() => false)) return;
      if (!cancelled) setShow(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [sampleToken]);

  function snooze() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000));
    } catch {
      /* storage unavailable: hidden for this visit only */
    }
    setShow(false);
  }

  if (!show) return null;
  return (
    <section aria-label="Try the sample's alerts" className="flex items-center gap-3 rounded-2xl bg-navy py-3 pl-3.5 pr-2 text-white">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-2 text-signal">
        <Icon name="bell" />
      </span>
      <p className="flex-1 text-sm font-semibold leading-snug">Try the sample&apos;s alerts on this phone</p>
      <Link href="/sample#sample-alerts" className="inline-flex h-10 shrink-0 items-center rounded-xl bg-white px-3.5 text-sm font-semibold text-ink">
        Try it
      </Link>
      <button type="button" onClick={snooze} aria-label="Not now (hide for 7 days)" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#DCE7F3] hover:bg-navy-2">
        <Icon name="close" />
      </button>
    </section>
  );
}
