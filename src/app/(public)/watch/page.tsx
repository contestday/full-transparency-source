import type { Metadata } from "next";
import { Container, PageHead } from "@/components/design";
import { WatchLinks } from "./watch-links";

export const metadata: Metadata = { title: "Your Geofences", robots: { index: false } };

export default async function WatchIndexPage({ searchParams }: PageProps<"/watch">) {
  // With a watch link saved, this opens it straight away; ?manage=1 shows the list.
  const manage = (await searchParams).manage === "1";
  return (
    <>
      <PageHead eyebrow="Your Geofences" title="Your watch links" lead="Your watch links on this phone: open one to change its areas, choose which one this phone uses, or add one you already have." />
      <Container className="max-w-3xl space-y-4 pb-20 pt-6">
      <WatchLinks manage={manage} />
      </Container>
    </>
  );
}
