import type { Metadata } from "next";
import { Container, PageHead } from "@/components/design";
import { InfoButton } from "@/components/info-button";
import { EVENTS_NOTE } from "@/lib/events/rules";
import { EventsClient } from "./events-client";

export const metadata: Metadata = { title: "Events" };

export default function EventsPage() {
  return (
    <>
      <PageHead title="Events" art="geofence" lead="Somewhere you'd rather I wasn't, for that time only. No name or account." />
      <Container className="space-y-5 pb-20 pt-6">
        <div className="rounded-[var(--ft-radius-card)] border border-border bg-surface p-4 text-sm">{EVENTS_NOTE}</div>
        <InfoButton label="How it works">
          <p>Mark an event: a concert, a match, a few days in a town. Choose the places, the dates, and how strongly: Wish, Want or Demand.</p>
          <p>It must be set at least 48 hours before it starts. It counts only while it&apos;s on, then it&apos;s kept on the record as ended.</p>
          <p>I see the event, its places and times, and so do you on your watch page, in black. Nobody else sees it.</p>
          <p>If a place includes my home, I&apos;m never expected to leave home for it, and time at home never counts.</p>
        </InfoButton>
        <EventsClient />
      </Container>
    </>
  );
}
