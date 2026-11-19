"use client";

import { useState, type ReactNode } from "react";
import { Overlay } from "@/components/overlay";
import type { PublicPlan } from "@/lib/public-data";
import { PlansMap } from "./map/plans-map";

/** Opens a map of one plan's place(s) over the page. */
export function PlanMapButton({ plan, className, children }: { plan: PublicPlan; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {children}
      </button>
      {open && (
        <Overlay title={plan.title} onClose={() => setOpen(false)} wide>
          <PlansMap plans={[plan]} className="h-[60vh] min-h-72 w-full" />
          <p className="mt-2 text-xs text-muted">Tap the marker for details. Some places are shown only as a general area.</p>
        </Overlay>
      )}
    </>
  );
}
