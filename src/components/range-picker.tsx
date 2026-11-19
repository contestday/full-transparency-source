import { Button, Input } from "@/components/ui";
import { Segmented } from "@/components/design";
import { ALL_TIME_FROM, quickRanges, ROUTE_MAX_DAYS, routesShown } from "@/lib/history-range";

/**
 * Date range choice for history pages: Today, Yesterday, This week, This month,
 * This year, All time; exact dates are tucked away under "Choose dates".
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
  /** Place search (public history only): undefined hides the search box. */
  place?: string;
}) {
  const placeQ = place ? `&place=${encodeURIComponent(place)}` : "";
  const ranges = quickRanges(today);
  const isQuick = ranges.some((r) => r.from === from && r.to === to);
  return (
    <div className="space-y-3">
      {place !== undefined && (
        <form className="flex flex-wrap items-end gap-2" method="get" action={basePath} role="search">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <label className="min-w-0 flex-1 basis-56 text-sm">
            <span className="block font-semibold">Search a place</span>
            <Input name="place" defaultValue={place} placeholder="Town, village or postcode" maxLength={100} className="bg-white" />
          </label>
          <Button type="submit">Search</Button>
          {place && (
            <a className="h-11 px-2 text-sm font-semibold leading-[2.75rem] text-accent underline" href={`${basePath}?from=${from}&to=${to}`}>
              Clear
            </a>
          )}
        </form>
      )}
      <Segmented
        items={ranges.map((r) => ({
          href: `${basePath}?from=${r.from}&to=${r.to}${placeQ}`,
          label: r.label,
          current: r.from === from && r.to === to,
        }))}
      />
      <details className="text-sm" open={!isQuick}>
        <summary className="cursor-pointer font-semibold text-accent">Choose dates</summary>
        <form className="mt-2 flex flex-wrap items-end gap-3" method="get" action={basePath}>
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
      </details>
      {!routesShown(from, to) && (
        <p className="text-sm text-muted">Showing the places I stayed. Routes are drawn for ranges up to {ROUTE_MAX_DAYS} days.</p>
      )}
    </div>
  );
}
