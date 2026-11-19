import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHead } from "@/components/design";
import { RangePicker } from "@/components/range-picker";
import { historyRange } from "@/lib/history-range";
import { WatchedHistory } from "./watched-history";

export const metadata: Metadata = { title: "Your view", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function WatchedHistoryPage({ searchParams }: PageProps<"/history/watched">) {
  const sp = await searchParams;
  const { today, from, to } = historyRange(sp);
  const placeQ = typeof sp.place === "string" ? sp.place.trim().slice(0, 100) : "";
  return (
    <>
      <PageHead
        title="Where I've been, in your colours"
        art="history"
        lead={
          <>
            Only you see these colours. <Link className="text-accent underline" href={`/history?from=${from}&to=${to}`}>Public view</Link>
          </>
        }
      />
      <RangePicker basePath="/history/watched" today={today} from={from} to={to} place={placeQ} />
      <Container className="space-y-4 pb-20 pt-6">
        <WatchedHistory from={from} to={to} place={placeQ} />
      </Container>
    </>
  );
}
