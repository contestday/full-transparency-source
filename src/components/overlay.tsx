"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * A panel over the page (not a new page): closes with the × button, Escape or
 * a tap outside it. Full height on phones, a centred card on larger screens.
 */
export function Overlay({ title, onClose, children, wide = false, id }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; id?: string }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

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
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl outline-none sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-5">
          <h2 id={titleId} className="min-w-0 text-lg font-bold [overflow-wrap:anywhere]">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="-mr-1 h-9 w-9 shrink-0 rounded-lg text-2xl leading-none text-muted hover:bg-sky" aria-label="Close">
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  );
}
