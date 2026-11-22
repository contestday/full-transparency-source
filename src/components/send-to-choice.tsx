"use client";

import { cn } from "@/components/ui";
import type { SendTo } from "@/lib/crimestoppers";

/** Police (you can give your name) or Crimestoppers (anonymous). */
export function SendToChoice({ value, onChange }: { value: SendTo; onChange: (v: SendTo) => void }) {
  const options: { v: SendTo; title: string; text: string }[] = [
    {
      v: "police",
      title: "The police",
      text: "You can give your name and how to reach you, so they can follow it up with you.",
    },
    {
      v: "crimestoppers",
      title: "Crimestoppers (anonymous)",
      text: "An independent charity. They never ask who you are, and pass what you tell them to the police.",
    },
  ];
  return (
    <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <label
          key={o.v}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
            value === o.v ? "border-2 border-accent bg-sky" : "border-border bg-white",
          )}
        >
          <input type="radio" name="send-to" className="mt-1 h-4 w-4" checked={value === o.v} onChange={() => onChange(o.v)} />
          <span>
            <span className="block font-semibold">{o.title}</span>
            <span className="block text-sm text-muted">{o.text}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
