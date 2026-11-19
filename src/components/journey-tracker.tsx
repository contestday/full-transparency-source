"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isOwnerDevice } from "@/lib/owner-device";

/**
 * Anonymous journey log for the public site. Records, for one visit:
 * the pages viewed, which buttons and links were tapped (their label, never
 * anything typed), and error messages shown. The visit ID is random, kept only
 * for this tab's visit (no cookie), so visits can't be linked to each other or
 * to a person. Watch links are removed before sending. Anything inside
 * [data-private] (a watcher's own area names) is never recorded.
 */

type Ev = { kind: "page" | "tap" | "error"; path: string; detail?: string; at: number };

function visitId(): string {
  try {
    let v = sessionStorage.getItem("ft-visit");
    if (!v) {
      const a = new Uint8Array(12);
      crypto.getRandomValues(a);
      v = [...a].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
      sessionStorage.setItem("ft-visit", v);
    }
    return v;
  } catch {
    return "";
  }
}

const here = () => location.pathname + location.search;
const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

export function JourneyTracker() {
  const pathname = usePathname();
  const queue = useRef<Ev[]>([]);

  const flush = () => {
    const events = queue.current.splice(0, 40);
    const id = visitId();
    if (!events.length || !id) return;
    const payload = JSON.stringify({ visit_id: id, events, ...(isOwnerDevice() ? { own: true } : {}), ...(navigator.webdriver ? { auto: true } : {}) });
    if (!navigator.sendBeacon?.("/api/events", new Blob([payload], { type: "application/json" }))) {
      fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => undefined);
    }
  };

  // Page views.
  useEffect(() => {
    if (!pathname || /^\/(admin|login|auth)(\/|$)/.test(pathname)) return;
    const last = queue.current.at(-1);
    if (last?.kind === "page" && last.path === here() && Date.now() - last.at < 2000) return; // same view twice
    queue.current.push({ kind: "page", path: here(), at: Date.now() });
  }, [pathname]);

  useEffect(() => {
    // Taps: the label of the button or link (never typed text).
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest("button, a, [role=button], summary");
      if (!el || el.closest("[data-private]")) return;
      const label = clean(el.getAttribute("aria-label") || el.textContent);
      const href = el instanceof HTMLAnchorElement ? new URL(el.href, location.origin).pathname : "";
      if (!label && !href) return;
      queue.current.push({ kind: "tap", path: here(), detail: href && !label ? `→ ${href}` : href ? `${label} → ${href}` : label, at: Date.now() });
    };
    // Errors shown on screen (red notices have role="alert").
    const seen = new WeakSet<Element>();
    const observer = new MutationObserver(() => {
      document.querySelectorAll('[role="alert"]').forEach((n) => {
        if (seen.has(n) || n.closest("[data-private]")) return;
        seen.add(n);
        const text = clean(n.textContent);
        if (text) queue.current.push({ kind: "error", path: here(), detail: text.slice(0, 200), at: Date.now() });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setInterval(flush, 8000);
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      observer.disconnect();
      clearInterval(timer);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
