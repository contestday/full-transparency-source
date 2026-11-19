import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHead } from "@/components/design";
import { RangePicker } from "@/components/range-picker";
import { historyRange } from "@/lib/history-range";
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
        <RangePicker basePath="/history/watched" today={today} from={from} to={to} />
      </PageHead>
      <Container className="space-y-4 pb-20 pt-6">
        <WatchedHistory from={from} to={to} />
      </Container>
    </>
  );
}
