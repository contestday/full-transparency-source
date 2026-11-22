"use client";

import Link from "next/link";
import { usePoliceWatchToken } from "@/lib/police-client";

/** Shows only on a device whose watch link has police reporting turned on. */
export function PlanPoliceButton({ planId }: { planId: string }) {
  const token = usePoliceWatchToken();
  if (!token) return null;
  return (
    <Link
      href={`/plans/${planId}/police`}
      prefetch={false}
      className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-[var(--ft-radius-control)] border border-border bg-white px-3 text-sm font-semibold hover:bg-sky"
    >
      Report to police
    </Link>
  );
}
