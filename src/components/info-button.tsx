"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/design";
import { cn } from "@/components/ui";

/**
 * A small (i) button that shows extra detail underneath when tapped, so pages
 * can stay short. One per section, not one per item.
 */
export function InfoButton({ label = "More information", children, className }: { label?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div data-sample-ok className={cn("text-sm", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-white px-3 text-[13px] font-semibold text-accent hover:bg-sky"
      >
        <Icon name={open ? "close" : "info"} className="h-4 w-4" />
        {open ? "Close" : label}
      </button>
      {open && (
        <div id={id} className="mt-2 space-y-2 rounded-xl border border-border bg-[#F7FAFD] p-3 text-[14px] leading-relaxed text-ink">
          {children}
        </div>
      )}
    </div>
  );
}
