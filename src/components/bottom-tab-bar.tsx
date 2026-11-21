"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, StatusDot, type IconName } from "@/components/design";
import { Overlay } from "@/components/overlay";
import { ShareButton } from "@/components/share-button";
import { cn } from "@/components/ui";
import { LIVE_STATUS_META } from "@/lib/live-status";
import { loadWatchLinks } from "@/lib/watch-links";
import { MENU, isCurrent, useLiveStatus, useStaff } from "@/components/site-header";

type Tab = { href: string; label: string; icon: IconName };

/**
 * Phones: a bottom tab bar with the five main places and More (every other
 * page, Share and the live status, in a sheet). Hidden on large screens,
 * where the header shows the menu.
 */
export function BottomTabBar() {
  const pathname = usePathname() ?? "/";
  const [more, setMore] = useState(false);
  const [watcher, setWatcher] = useState(false);
  // "Your places" only once this device's watch link has areas; otherwise "Watch a place".
  const [hasAreas, setHasAreas] = useState(false);
  useEffect(() => {
    const token = loadWatchLinks()[0]?.token;
    if (!token) return;
    let live = true;
    fetch(`/api/watch/${token}/info`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((i: { valid?: boolean; areas?: number } | null) => live && setHasAreas(Boolean(i?.valid && (i.areas ?? 0) > 0)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pathname]);
  const staff = useStaff();
  const status = useLiveStatus(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWatcher(loadWatchLinks().length > 0);
    setMore(false);
  }, [pathname]);

  // Watchers get "Your places" in place of "Watch".
  const tabs: Tab[] = [
    { href: "/", label: "Home", icon: "home" },
    { href: "/history", label: "History", icon: "history" },
    { href: "/plans", label: "Plans", icon: "calendar" },
    { href: "/events", label: "Events", icon: "target" },
    watcher && hasAreas ? { href: "/watch", label: "Your places", icon: "layers" } : { href: "/geofences/submit", label: "Watch", icon: "pin" },
  ];
  const inTabs = (href: string) => tabs.some((t) => t.href === href);
  const moreItems = MENU.filter((m) => !inTabs(m.href) && (m.href !== "/history/watched" || watcher));
  const items = staff ? [...moreItems, { href: "/admin", label: "Admin", icon: "lock" as IconName }] : moreItems;
  const moreOn = items.some((m) => isCurrent(pathname, m.href));
  const chip = status && status !== "disabled" ? status : null;

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-border bg-white/95 px-1 pb-[calc(10px+env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden print:hidden"
      >
        {tabs.map((t) => {
          const on = isCurrent(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={cn("flex flex-col items-center justify-center gap-0.5 whitespace-nowrap text-xs font-semibold", on ? "text-accent" : "text-muted")}
            >
              <span className={cn("flex h-[30px] w-12 items-center justify-center rounded-full", on && "bg-blue-100")}>
                <Icon name={t.icon} />
              </span>
              {t.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-haspopup="dialog"
          className={cn("flex flex-col items-center justify-center gap-0.5 text-xs font-semibold", moreOn ? "text-accent" : "text-muted")}
        >
          <span className={cn("flex h-[30px] w-12 items-center justify-center rounded-full", moreOn && "bg-blue-100")}>
            <Icon name="menu" />
          </span>
          More
        </button>
      </nav>
      {more && (
        <Overlay title="More" onClose={() => setMore(false)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5">
              {items.map((m) => {
                const on = isCurrent(pathname, m.href);
                return (
                  <Link
                    key={m.href}
                    href={m.href}
                    aria-current={on ? "page" : undefined}
                    className={cn("flex min-h-[88px] flex-col items-start justify-between gap-2 rounded-2xl border p-3.5 font-semibold", on ? "border-2 border-ink" : "border-hairline bg-white")}
                  >
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-accent">
                      <Icon name={m.icon} />
                    </span>
                    {m.label}
                  </Link>
                );
              })}
              <ShareButton variant="tile" />
            </div>
            {chip && (
              <Link href="/#status" className="flex items-center gap-3 rounded-2xl border border-hairline p-4">
                <StatusDot status={chip} className="h-4 w-4" />
                <span>
                  <span className="block text-xs font-bold uppercase tracking-[.08em] text-muted">Live status</span>
                  <span className="font-semibold">{LIVE_STATUS_META[chip].label}</span>
                </span>
              </Link>
            )}
          </div>
        </Overlay>
      )}
    </>
  );
}
