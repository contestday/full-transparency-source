"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Input, cn } from "@/components/ui";
import { Icon } from "@/components/design";
import { ALL_TIME_FROM, quickRanges, ROUTE_MAX_DAYS, routesShown } from "@/lib/history-range";

/**
 * The period bar for history pages: one sticky row (Today … All time) that
 * scrolls sideways on phones, with the place search behind a search icon and
 * exact dates behind "Dates…".
 */
export function RangePicker({
  basePath,
  today,
  from,
  to,
  place,
}: {
  basePath: string;
  today: string;
  from: string;
  to: string;
  /** Place search: undefined hides the search icon. */
  place?: string;
}) {
  const placeQ = place ? `&place=${encodeURIComponent(place)}` : "";
  const ranges = quickRanges(today);
  const isQuick = ranges.some((r) => r.from === from && r.to === to);
  const [panel, setPanel] = useState<"search" | "dates" | null>(place ? "search" : isQuick ? null : "dates");
  const chip = "inline-flex h-[38px] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold";

  return (
    <div className="sticky top-[60px] z-20 border-b border-border bg-white/95 shadow-[0_6px_16px_rgb(20_43_73/7%)] backdrop-blur lg:top-[76px] print:static">
      <div className="mx-auto w-full max-w-[1264px]">
        <div className="relative">
          <div className="ft-scroll-x flex gap-2 py-2.5 pl-4 pr-10 sm:px-8" role="group" aria-label="Period">
            {place !== undefined && (
              <button
                type="button"
                aria-label="Search a place"
                aria-expanded={panel === "search"}
                onClick={() => setPanel((p) => (p === "search" ? null : "search"))}
                className={cn(chip, "w-[38px] justify-center px-0", panel === "search" || place ? "border-ink bg-ink text-white" : "border-border bg-white")}
              >
                <Icon name="search" className="h-[18px] w-[18px]" />
              </button>
            )}
            {ranges.map((r) => {
              const on = r.from === from && r.to === to;
              return (
                <Link
                  key={r.key}
                  href={`${basePath}?from=${r.from}&to=${r.to}${placeQ}`}
                  aria-current={on ? "true" : undefined}
                  className={cn(chip, on ? "border-ink bg-ink text-white" : "border-border bg-white text-ink hover:bg-ice")}
                >
                  {r.label}
                </Link>
              );
            })}
            <button
              type="button"
              aria-expanded={panel === "dates"}
              onClick={() => setPanel((p) => (p === "dates" ? null : "dates"))}
              className={cn(chip, !isQuick ? "border-ink bg-ink text-white" : "border-border bg-white text-ink")}
            >
              Dates…
            </button>
          </div>
          <span className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-white/0 to-white sm:hidden" aria-hidden="true" />
        </div>

        {panel === "search" && place !== undefined && (
          <form className="flex flex-wrap items-end gap-2 px-4 pb-3 sm:px-8" method="get" action={basePath} role="search">
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <label className="min-w-0 flex-1 basis-56 text-sm">
              <span className="sr-only">Search a place</span>
              <Input name="place" defaultValue={place} placeholder="Town, village or postcode" maxLength={100} className="bg-white" autoFocus={!place} />
            </label>
            <Button type="submit">Search</Button>
            {place && (
              <Link className="h-11 px-2 text-sm font-semibold leading-[2.75rem] text-accent underline" href={`${basePath}?from=${from}&to=${to}`}>
                Clear
              </Link>
            )}
          </form>
        )}
        {panel === "dates" && (
          <form className="flex flex-wrap items-end gap-3 px-4 pb-3 sm:px-8" method="get" action={basePath}>
            <label className="text-sm">
              <span className="block font-semibold">From</span>
              <Input type="date" name="from" defaultValue={from === ALL_TIME_FROM ? "" : from} max={to} className="w-auto bg-white" />
            </label>
            <label className="text-sm">
              <span className="block font-semibold">To</span>
              <Input type="date" name="to" defaultValue={to} className="w-auto bg-white" />
            </label>
            {place && <input type="hidden" name="place" value={place} />}
            <Button type="submit">Show</Button>
          </form>
        )}
        {!routesShown(from, to) && (
          <p className="px-4 pb-2 text-xs text-muted sm:px-8">Showing the places I stayed. Routes are drawn for up to {ROUTE_MAX_DAYS} days.</p>
        )}
      </div>
    </div>
  );
}
