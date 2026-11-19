"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui";
import { Icon } from "@/components/design";

/** Registers the service worker on every page so the site is installable. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* not fatal: the site works without it */
    });
  }, []);
  return null;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __ftInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

type Platform = "ios" | "samsung" | "android-firefox" | "android" | "desktop-safari" | "desktop" | "other";

function detectPlatform(ua: string): Platform {
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/samsungbrowser/i.test(ua)) return "samsung";
  if (/android/i.test(ua) && /firefox/i.test(ua)) return "android-firefox";
  if (/android/i.test(ua)) return "android";
  if (/safari/i.test(ua) && !/chrome|chromium|edg/i.test(ua)) return "desktop-safari";
  if (/chrome|chromium|edg/i.test(ua)) return "desktop";
  return "other";
}

/** Step-by-step instructions for installing from the browser's own menu. */
const STEPS: Record<Platform, string> = {
  ios: "Tap the Share button (the square with an arrow), then “Add to Home Screen”, then Add.",
  samsung: "Tap the menu (≡) at the bottom, then “Add page to”, then “Home screen”.",
  "android-firefox": "Tap the menu (⋮), then “Install”.",
  android: "Tap the menu (⋮) at the top right, then “Add to Home screen” (or “Install app”), then Install.",
  "desktop-safari": "In the menu bar choose File, then “Add to Dock”.",
  desktop: "Click the install icon at the right of the address bar, or open the menu (⋮) and choose “Cast, save and share”, then “Install page as app”.",
  other: "Open your browser's menu and choose “Install app” or “Add to Home screen”.",
};

function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as { standalone?: boolean }).standalone);
}

/** Install state shared by the banner and the in-page button. */
function useInstall() {
  const [state, setState] = useState<{ ready: boolean; installed: boolean; prompt: BeforeInstallPromptEvent | null; platform: Platform }>({
    ready: false,
    installed: false,
    prompt: null,
    platform: "other",
  });
  useEffect(() => {
    const sync = () =>
      setState({ ready: true, installed: isInstalled(), prompt: window.__ftInstallPrompt ?? null, platform: detectPlatform(navigator.userAgent) });
    const t = setTimeout(sync, 0);
    const onInstalled = () => setState((s) => ({ ...s, installed: true, prompt: null }));
    window.addEventListener("ft-install-ready", sync);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(t);
      window.removeEventListener("ft-install-ready", sync);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const install = async () => {
    const p = state.prompt;
    if (!p) return false;
    await p.prompt();
    const { outcome } = await p.userChoice;
    window.__ftInstallPrompt = null; // a prompt can only be used once
    setState((s) => ({ ...s, prompt: null, installed: outcome === "accepted" }));
    return outcome === "accepted";
  };
  return { ...state, install };
}

/**
 * "Install app" control for a page section. Uses the browser's install prompt
 * when it offers one; otherwise (e.g. after an earlier "not now", when Chrome
 * stops offering it) shows the menu steps, so installing is always possible.
 */
export function InstallAppButton({ label = "Install as an app", hint }: { label?: string; hint?: string }) {
  const { ready, installed, prompt, platform, install } = useInstall();
  if (!ready) return null;
  if (installed) return <p className="text-sm font-medium text-jade">Installed. Open it from your home screen.</p>;
  return (
    <div className="space-y-2">
      {prompt ? (
        <Button type="button" onClick={() => void install()}>
          {label}
        </Button>
      ) : (
        <p className="text-sm">
          <strong>To install:</strong> {STEPS[platform]}
        </p>
      )}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

const LATER_KEY = "ft-install-later";

/**
 * Shown on every visit until the site is installed: installing is the only
 * way to get notifications on a phone. "Not now" hides it for this visit only.
 */
export function InstallBanner() {
  const watch = (usePathname() ?? "").startsWith("/watch/");
  const { ready, installed, prompt, platform, install } = useInstall();
  const [later, setLater] = useState(true);
  useEffect(() => {
    let hidden = false;
    try {
      hidden = sessionStorage.getItem(LATER_KEY) === "1";
    } catch {
      /* storage blocked: show it */
    }
    const t = setTimeout(() => setLater(hidden), 0);
    return () => clearTimeout(t);
  }, []);
  if (!ready || installed || later) return null;

  const close = () => {
    try {
      sessionStorage.setItem(LATER_KEY, "1");
    } catch {
      /* ignore */
    }
    setLater(true);
  };
  return (
    <div role="region" aria-label="Install the app" className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-40 p-3 sm:left-auto sm:right-4 sm:max-w-md lg:bottom-4 lg:p-0">
      <div className="rounded-[var(--ft-radius-card)] border border-border bg-surface p-4 shadow-[0_14px_36px_rgb(20_43_73/22%)]">
        <div className="flex items-start gap-3">
          <Icon name="bell" className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-bold">{watch ? "Install your watch view" : "Install Full Transparency"}</p>
            <p className="text-sm text-muted">
              Installing is the only way to get notifications on a phone{watch ? ", and it opens straight to your areas" : ""}.
            </p>
            {prompt ? (
              <Button type="button" onClick={() => void install()}>
                Install
              </Button>
            ) : (
              <p className="text-sm">{STEPS[platform]}</p>
            )}
          </div>
          <button type="button" onClick={close} className="inline-flex h-9 shrink-0 items-center rounded-lg px-2 text-sm text-muted hover:bg-sky" aria-label="Not now">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
