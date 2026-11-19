"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** A "back" waiting to run after a panel closed (cancelled if a panel opens straight away, as in React's development double-run). */
let pendingBack: ReturnType<typeof setTimeout> | null = null;

/**
 * A panel over the page (not a new page). On phones it's a sheet that rises
 * from the bottom: drag it down, tap outside, press Escape or the back button
 * to close. On larger screens it's a centred card.
 */
export function Overlay({ title, onClose, children, wide = false, id }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; id?: string }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    // The back button closes the panel rather than leaving the page.
    let closedByBack = false;
    if (pendingBack) {
      clearTimeout(pendingBack);
      pendingBack = null;
    } else history.pushState({ ftOverlay: true }, "");
    const onPop = () => {
      closedByBack = true;
      close.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = overflow;
      if (!closedByBack && history.state?.ftOverlay) {
        pendingBack = setTimeout(() => {
          pendingBack = null;
          history.back();
        }, 0);
      }
    };
  }, []);

  // Swipe down on the handle or title bar to close (phones).
  const onTouchStart = (e: React.TouchEvent) => {
    start.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (start.current == null) return;
    setDrag(Math.max(0, e.touches[0].clientY - start.current));
  };
  const onTouchEnd = () => {
    if (drag > 90) onClose();
    setDrag(0);
    start.current = null;
  };

  return (
    <div
      data-sample-ok
      data-overlay
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        id={id}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface text-ink shadow-xl outline-none transition-transform sm:rounded-3xl ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}
      >
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className="touch-none">
          <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
            <span className="h-1.5 w-10 rounded-full bg-border" />
          </div>
          <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-5">
            <h2 id={titleId} className="min-w-0 pt-1.5 text-lg font-bold [overflow-wrap:anywhere]">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-muted hover:bg-sky"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>
        <div className="overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5">{children}</div>
      </div>
    </div>
  );
}
