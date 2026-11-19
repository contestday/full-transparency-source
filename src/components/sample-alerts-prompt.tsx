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
    <section className="flex flex-wrap items-center gap-5 rounded-[var(--ft-radius-card)] border-2 border-[#B45309] bg-[#FFF4D6] p-6 sm:p-8">
      <Icon name="bell" className="h-10 w-10 shrink-0 text-[#B45309]" />
      <div className="min-w-0 flex-1 basis-72 space-y-2">
        <h2 className="text-[24px] font-bold sm:text-[28px]">Try it: get the sample&apos;s real alerts</h2>
        <p className="text-[16px]">
          The sample watcher has real areas set up. Turn on sample alerts and your phone gets the same alerts a watcher would, as they happen, each
          clearly marked <strong>SAMPLE</strong>. Turn them off any time with one tap.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/sample#sample-alerts"
          className="inline-flex h-12 items-center gap-2 rounded-[var(--ft-radius-control)] bg-[#B45309] px-5 font-semibold text-white hover:brightness-95"
        >
          Open the sample <span aria-hidden="true">→</span>
        </Link>
        <button type="button" onClick={snooze} className="h-12 px-2 text-sm font-semibold text-[#7C2D12] underline">
          Not now (hide for 7 days)
        </button>
      </div>
    </section>
  );
}
