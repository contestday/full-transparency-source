import type { Metadata } from "next";
import Link from "next/link";
import { Container, EmptyState } from "@/components/design";
import { loadSampleWatcher } from "@/lib/sample-watcher";
import { optionalEnv } from "@/lib/env";
import { WatchView } from "../watch/[token]/watch-view";

export const metadata: Metadata = {
  title: "Sample Geofence View (Live)",
  description: "See what someone watching an area sees, compared with the public view.",
};
export const dynamic = "force-dynamic";

/** The public, read-only sample of a watcher's view (set up and locked by me). */
export default async function SamplePage() {
  const sample = await loadSampleWatcher().catch(() => null);
  if (!sample?.locked) {
    return (
      <Container className="max-w-3xl py-10">
        <EmptyState icon="eye" title="The sample watcher view isn't ready yet.">
          Please check back soon. Meanwhile, see the <Link className="text-accent underline" href="/history">public history</Link>.
        </EmptyState>
      </Container>
    );
  }
  return <WatchView token={sample.token} vapidPublicKey={optionalEnv("VAPID_PUBLIC_KEY") ?? null} sample />;
}
