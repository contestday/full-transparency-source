import type { Metadata } from "next";
import Link from "next/link";
import { Button, Input } from "@/components/ui";
import { Container, PageHead, Segmented } from "@/components/design";
import { historyRange, quickRanges } from "@/lib/history-range";
import { WatchedHistory } from "./watched-history";

export const metadata: Metadata = { title: "Your History (Geofence)", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function WatchedHistoryPage({ searchParams }: PageProps<"/history/watched">) {
  const { today, from, to } = historyRange(await searchParams);
  return (
    <>
      <PageHead
        eyebrow="Your History (Geofence)"
        title="Where I've been, in your colours"
        art="history"
        lead={
          <>
            The same history everyone can see, coloured for the watch link saved on this device: amber in your Wish areas, red in
            your Want areas, purple at your Locations. Each area colours only what happened after you set it. Only you see these colours. <Link className="text-accent underline" href={`/history?from=${from}&to=${to}`}>Public history</Link> shows what everyone else sees.
          </>
        }
      >
        <div className="mb-4">
          <Segmented
            items={quickRanges(today).map((r) => ({
              href: `/history/watched?from=${r.from}&to=${r.to}`,
              label: r.label,
              current: r.from === from && r.to === to,
            }))}
          />
        </div>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="text-sm">
            <span className="block font-semibold">From</span>
            <Input type="date" name="from" defaultValue={from} max={to} className="w-auto bg-white" />
          </label>
          <label className="text-sm">
            <span className="block font-semibold">To</span>
            <Input type="date" name="to" defaultValue={to} className="w-auto bg-white" />
          </label>
          <Button type="submit">Show</Button>
        </form>
      </PageHead>
      <Container className="space-y-4 pb-20 pt-6">
        <WatchedHistory from={from} to={to} />
      </Container>
    </>
  );
}
