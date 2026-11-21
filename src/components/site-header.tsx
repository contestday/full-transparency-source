"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand";
import { Icon, STATUS_TONE, StatusDot, type IconName } from "@/components/design";
import { ShareButton } from "@/components/share-button";
import { cn } from "@/components/ui";
import { LIVE_STATUS_META } from "@/lib/live-status";
import { loadWatchLinks } from "@/lib/watch-links";

/** Every page in the menu (short labels; each page's heading describes it). */
export const MENU: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/history/watched", label: "Your view", icon: "eye" },
  { href: "/geofences/submit", label: "Watch", icon: "pin" },
  { href: "/events", label: "Events", icon: "calendar" },
  { href: "/watch", label: "Your places", icon: "layers" },
  { href: "/sample", label: "Sample", icon: "eye" },
  { href: "/plans", label: "Plans", icon: "calendar" },
  { href: "/report", label: "Message", icon: "chat" },
  { href: "/privacy", label: "Privacy", icon: "lock" },
  { href: "/about", label: "FAQs", icon: "info" },
];
/** On desktop, these sit under "More" so the header stays on one line. */
const DESKTOP_MORE = new Set(["/sample", "/privacy", "/about"]);

type Status = keyof typeof LIVE_STATUS_META;

export function isCurrent(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/history") return pathname === "/history";
  if (href === "/geofences/submit") return pathname.startsWith("/geofences");
  if (href === "/watch") return pathname.startsWith("/watch");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function useLiveStatus(enabled: boolean): Status | null {
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

/** Signed in as staff: an Admin link is added (the installed app has no address bar). */
export function useStaff(): boolean {
  const [staff, setStaff] = useState(false);
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setStaff(Boolean(b?.staff)))
      .catch(() => undefined);
  }, []);
  return staff;
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  // The private watch view shows its own status; don't show the public one there.
  const showChip = !pathname.startsWith("/watch/");
  const status = useLiveStatus(showChip);
  const chip = showChip && status && status !== "disabled" ? status : null;
  const staff = useStaff();
  const [watcher, setWatcher] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWatcher(loadWatchLinks().length > 0);
    setMoreOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => !moreRef.current?.contains(e.target as Node) && setMoreOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const visible = MENU.filter((n) => n.href !== "/history/watched" || watcher);
  const main = visible.filter((n) => !DESKTOP_MORE.has(n.href));
  const more = [...visible.filter((n) => DESKTOP_MORE.has(n.href)), ...(staff ? [{ href: "/admin", label: "Admin", icon: "lock" as IconName }] : [])];
  const moreOn = more.some((m) => isCurrent(pathname, m.href));

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur print:hidden">
      <div className="mx-auto flex h-[60px] w-full max-w-[1264px] items-center gap-2 px-4 sm:px-8 lg:h-[76px] lg:gap-4">
        <Link href="/" aria-label="Full Transparency home" className="mr-auto shrink-0">
          {/* Mark + real text, so the name is readable on a phone. */}
          <span className="inline-flex items-center gap-2">
            <Logo variant="mark" className="h-9 w-9 lg:h-11 lg:w-11" />
            <span className="font-display text-[18px] font-bold leading-none tracking-[-0.01em] text-ink lg:text-[21px]">Full Transparency</span>
          </span>
        </Link>

        {/* Desktop: the menu in the header. */}
        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {main.map((n) => {
            const on = isCurrent(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center rounded-lg px-3 text-[15px] font-semibold",
                  on ? "bg-sky text-ink shadow-[inset_0_-3px_0_var(--accent)]" : "text-muted hover:bg-ice hover:text-ink",
                )}
              >
                {n.label}
              </Link>
            );
          })}
          <div ref={moreRef} className="relative">
            <button
              type="button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}
              className={cn(
                "inline-flex h-10 items-center gap-1 rounded-lg px-3 text-[15px] font-semibold",
                moreOn ? "bg-sky text-ink shadow-[inset_0_-3px_0_var(--accent)]" : "text-muted hover:bg-ice hover:text-ink",
              )}
            >
              More <Icon name="chevron" className="h-4 w-4 rotate-90" />
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-2xl border border-border bg-white py-1 shadow-xl">
                {more.map((m) => (
                  <Link
                    key={m.href}
                    href={m.href}
                    aria-current={isCurrent(pathname, m.href) ? "page" : undefined}
                    className="flex h-11 items-center gap-3 px-4 text-[15px] font-medium hover:bg-ice"
                  >
                    <Icon name={m.icon} className="h-4 w-4 text-accent" />
                    {m.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>

        {chip && (
          <Link
            href="/#status"
            aria-label={`Live status: ${LIVE_STATUS_META[chip].label}`}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] font-semibold lg:text-sm"
            style={{ background: STATUS_TONE[chip].bg, color: STATUS_TONE[chip].ink }}
          >
            <StatusDot status={chip} />
            <span className="hidden min-[400px]:inline lg:hidden">{STATUS_TONE[chip].short}</span>
            <span className="hidden lg:inline">{LIVE_STATUS_META[chip].label}</span>
          </Link>
        )}

        <span className="lg:hidden">
          <ShareButton variant="icon" />
        </span>
        <span className="hidden lg:inline-flex">
          <ShareButton variant="pill" />
        </span>
      </div>
    </header>
  );
}
