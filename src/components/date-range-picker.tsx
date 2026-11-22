"use client";

import { Input } from "@/components/ui";
import { cn } from "@/components/ui";
import { RANGE_PRESETS, type DateRange } from "@/lib/report-range";

/** Quick periods (last month, next 6 weeks…) or any From and To dates. */
export function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {RANGE_PRESETS.map((p) => {
          const r = p.range();
          const on = r.from === value.from && r.to === value.to;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(r)}
              aria-pressed={on}
              className={cn(
                "min-h-9 rounded-full border px-3 text-sm font-semibold",
                on ? "border-accent bg-accent text-accent-foreground" : "border-border bg-white hover:bg-sky",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm font-semibold">
          <span>From</span>
          <Input type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          <span>To</span>
          <Input type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </label>
      </div>
    </div>
  );
}
