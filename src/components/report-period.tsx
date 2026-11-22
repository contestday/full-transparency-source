"use client";

import { DateRangePicker } from "@/components/date-range-picker";
import { MOVEMENT_DAYS, rangeText, validRange, type PeriodChoice, type RangeFacts } from "@/lib/report-range";

/**
 * Choose a period, then whether to add the plans published for it and the
 * full movement record for it (every stay, journey and GPS reading, home area
 * included; other people's homes are timed but not named).
 */
export function ReportPeriod({
  value,
  onChange,
  facts,
  skipPlanId,
}: {
  value: PeriodChoice;
  onChange: (v: PeriodChoice) => void;
  facts: RangeFacts;
  skipPlanId?: string;
}) {
  const ok = validRange(value.range);
  const plans = facts.plans.filter((p) => p.id !== skipPlanId).length;
  const m = facts.movement;
  const parts = [
    value.plans ? `${plans} ${skipPlanId ? "other " : ""}plan${plans === 1 ? "" : "s"}` : null,
    value.visits && m ? `${m.stays.length} stays, ${m.journeys.length} journeys and ${m.points.length.toLocaleString("en-GB")} GPS readings` : null,
    value.visits && !m ? "no movements yet (these dates are all in the future)" : null,
  ].filter(Boolean);
  return (
    <div className="space-y-3">
      <DateRangePicker value={value.range} onChange={(range) => onChange({ ...value, range })} />
      {!ok && <p className="text-sm text-red-700">Choose a From date on or before the To date.</p>}
      <div className="space-y-2">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={value.plans} onChange={(e) => onChange({ ...value, plans: e.target.checked })} />
          <span>
            <span className="font-semibold">Plans in these dates</span>
            <span className="block text-muted">Past and coming up, as published on the Plans page.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={value.visits} onChange={(e) => onChange({ ...value, visits: e.target.checked })} />
          <span>
            <span className="font-semibold">Every stay, journey and GPS reading</span>
            <span className="block text-muted">
              The full record up to today, home area included (up to {MOVEMENT_DAYS} days at a time). Other people&apos;s homes show the times only, with the
              address available to police on request.
            </span>
          </span>
        </label>
      </div>
      {ok && (value.plans || value.visits) && (
        <p className={facts.error ? "rounded-lg bg-red-50 p-3 text-sm text-red-900" : "rounded-lg bg-[#F7FAFD] p-3 text-sm"} aria-live="polite">
          {facts.loading ? "Loading…" : facts.error ? facts.error : `${rangeText(value.range)}: ${parts.join(", ")}. These go in your report.`}
        </p>
      )}
    </div>
  );
}
