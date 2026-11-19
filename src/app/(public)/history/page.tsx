import type { Metadata } from "next";
import Link from "next/link";
import { getPublicHistory } from "@/lib/public-data";
import { Notice } from "@/components/ui";
import { Container, PageHead } from "@/components/design";
import { RangePicker } from "@/components/range-picker";
import { fmtDateTime } from "@/lib/format";
import { HistoryView } from "./history-view";
import { WatcherOnly } from "@/components/watcher-only";
import { colourHistory, loadPublicZoneContext } from "@/lib/zones";
import { historyRange, routesShown } from "@/lib/history-range";
import { loadHomeArea } from "@/lib/home";
import { lookupPlace } from "@/lib/place-lookup";
import { pointInArea } from "@/lib/geofence/area-geometry";

export const metadata: Metadata = { title: "History" };
export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const sp = await searchParams;
  const { today, from, to } = historyRange(sp);

  let data: Awaited<ReturnType<typeof getPublicHistory>> = { records: [], lastPublishedAt: null, paused: false };
  let failed = false;
  try {
    data = await getPublicHistory(`${from}T00:00:00Z`, `${to}T23:59:59.999Z`, { stopsOnly: !routesShown(from, to) });
  } catch (err) {
    console.error(err);
    failed = true;
  }

  // Place search: only what happened inside the searched place.
  const placeQ = typeof sp.place === "string" ? sp.place.trim().slice(0, 100) : "";
  const place = placeQ.length >= 2 ? await lookupPlace(placeQ) : null;
  if (place) data = { ...data, records: data.records.filter((r) => pointInArea({ lat: r.public_lat, lng: r.public_lng }, place.geometry)) };

  // Colours worked out here, so my okay zone and own areas never leave the server:
  // green within the okay zone, yellow outside, red in my noted areas.
  const { route, stopZones } = colourHistory(data.records, await loadPublicZoneContext());

  return (
    <>
      <PageHead
        title="Where I've been"
        art="history"
        lead={
          <>
            My stays and routes on a map. Updated <strong className="text-ink">{fmtDateTime(data.lastPublishedAt)}</strong>.
          </>
        }
      >
        <RangePicker basePath="/history" today={today} from={from} to={to} place={placeQ} />
      </PageHead>
      <Container className="space-y-4 pb-20 pt-6">
        {data.paused && (
          <Notice tone="amber" title="Publication is currently paused">
            Records already published stay visible. New records will not appear until publication resumes.
          </Notice>
        )}
        {failed && <Notice tone="red">History could not be loaded. Please try again later.</Notice>}
        {placeQ && !place && <Notice tone="amber">No place called “{placeQ}” was found. Try a town, village or postcode.</Notice>}
        {place && (
          <Notice tone="blue" title={`Showing only ${place.label}`}>
            {data.records.filter((r) => r.kind === "visit").length} stays there in these dates. The place is outlined on the map.
          </Notice>
        )}
        <WatcherOnly>
          <p className="text-sm">
            <Link className="font-semibold text-accent underline" href={`/history/watched?from=${from}&to=${to}`}>See this in your colours</Link>
          </p>
        </WatcherOnly>
        <HistoryView records={data.records} route={route} stopZones={stopZones} homeArea={await loadHomeArea().catch(() => null)} searchArea={place?.geometry ?? null} />
        <p className="text-xs text-muted">
          The route and stops are shown at their recorded GPS positions. Nothing is shown near home.
          Named pins are public venues. A record shows what a GPS source reported; it does not by itself prove who
          carried the device.
        </p>
      </Container>
    </>
  );
}
