"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand";
import { Icon, StatusDot, type IconName } from "@/components/design";
import { cn } from "@/components/ui";
import { LIVE_STATUS_META } from "@/lib/live-status";
import { loadWatchLinks } from "@/lib/watch-links";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/history/watched", label: "Your view", icon: "eye" },
  { href: "/geofences/submit", label: "Watch", icon: "pin" },
  { href: "/watch", label: "Your places", icon: "layers" },
  { href: "/sample", label: "Sample", icon: "eye" },
  { href: "/plans", label: "Plans", icon: "calendar" },
  { href: "/report", label: "Message", icon: "chat" },
  { href: "/privacy", label: "Privacy", icon: "lock" },
  { href: "/about", label: "FAQs", icon: "info" },
];

type Status = keyof typeof LIVE_STATUS_META;

function isCurrent(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/history") return pathname === "/history";
  if (href === "/geofences/submit") return pathname.startsWith("/geofences");
  if (href === "/watch") return pathname.startsWith("/watch");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function useLiveStatus(enabled: boolean): Status | null {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/public/live", { cache: "no-store" });
        if (r.ok && alive) setStatus(((await r.json()).status as Status) ?? null);
      } catch {
        /* ignore */
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [enabled]);
  return status;
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  // The private watch view shows its own status; don't show the public one there.
  const showChip = !pathname.startsWith("/watch/");
  const status = useLiveStatus(showChip);
  const chipStatus = status && status !== "disabled" ? status : null;
  // Signed in as staff: add an Admin link (the installed app has no address bar).
  const [staff, setStaff] = useState(false);
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setStaff(Boolean(b?.staff)))
      .catch(() => undefined);
  }, []);
  // "Where I.ve been: your view" only for watchers: this device has a watch link saved.
  const [watcher, setWatcher] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWatcher(loadWatchLinks().length > 0);
  }, [pathname]);
  const visible = NAV.filter((n) => n.href !== "/history/watched" || watcher);
  const nav = staff ? [...visible, { href: "/admin", label: "Admin", icon: "lock" as IconName }] : visible;

  useEffect(() => {
    // Close the menu on navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const first = sheet.current?.querySelector<HTMLElement>("a,button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
      if (e.key === "Tab" && sheet.current) {
        const items = [...sheet.current.querySelectorAll<HTMLElement>("a,button")];
        const firstEl = items[0];
        const lastEl = items.at(-1);
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl?.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
    <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[1264px] items-center gap-3 px-4 sm:px-8 lg:h-[72px]">
        <Link href="/" aria-label="Full Transparency home" className="mr-auto">
          {/* Mark + real text, so the name is readable on a phone. */}
          <span className="inline-flex items-center gap-2.5">
            <Logo variant="mark" className="h-10 w-10 lg:h-11 lg:w-11" />
            <span className="text-[20px] font-bold leading-none tracking-[-0.01em] text-ink lg:text-[22px]">Full Transparency</span>
          </span>
        </Link>

        {showChip && chipStatus && (
          <Link
            href="/#status"
            className="hidden h-9 items-center gap-2 rounded-full border border-border bg-white px-3 text-sm font-medium lg:inline-flex"
          >
            <StatusDot status={chipStatus} />
            {LIVE_STATUS_META[chipStatus].label}
          </Link>
        )}

        {showChip && chipStatus && (
          <Link
            href="/#status"
            aria-label={`Live status: ${LIVE_STATUS_META[chipStatus].label}`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border lg:hidden"
          >
            <StatusDot status={chipStatus} className="h-3.5 w-3.5" />
          </Link>
        )}

        <button
          ref={menuButton}
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] border border-border"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name={open ? "close" : "menu"} />
        </button>
      </div>
    </header>

      {/* Outside the header: its backdrop blur would trap a fixed-position sheet. */}
      {open && (
        <div
          id="mobile-menu"
          ref={sheet}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-white lg:left-auto lg:top-[72px] lg:w-[400px] lg:border-l lg:border-border lg:shadow-xl"
        >
          <nav aria-label="Primary" className="divide-y divide-hairline border-b border-hairline">
            {nav.map((n) => {
              const on = isCurrent(pathname, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={on ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex h-14 w-full items-center gap-3 px-5 text-base font-medium",
                    on ? "bg-sky shadow-[inset_3px_0_0_var(--accent)]" : "",
                  )}
                >
                  <Icon name={n.icon} className="text-accent" />
                  <span className="flex-1">{n.label}</span>
                  <Icon name="chevron" className="h-4 w-4 text-muted" />
                </Link>
              );
            })}
          </nav>
          {chipStatus && (
            <Link href="/#status" className="m-5 flex items-center gap-3 rounded-[var(--ft-radius-card)] border border-border p-4">
              <StatusDot status={chipStatus} className="h-4 w-4" />
              <span>
                <span className="block text-xs font-bold uppercase tracking-[.08em] text-muted">Live status</span>
                <span className="font-semibold">{LIVE_STATUS_META[chipStatus].label}</span>
              </span>
            </Link>
          )}
        </div>
      )}
    </>
  );
}
