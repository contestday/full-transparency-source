import type { Metadata } from "next";
import { Container, PageHead } from "@/components/design";
import { ContactAction } from "../contact-action";

export const metadata: Metadata = { title: "Stop automatic reports", robots: { index: false } };

export default async function Page({ searchParams }: PageProps<"/contacts/stop">) {
  const t = (await searchParams).t;
  return (
    <>
      <PageHead eyebrow="Automatic reports" title="Stop automatic reports" lead="Stop the automatic reports to your email address." />
      <Container className="max-w-2xl pb-20 pt-8">
        <ContactAction action="stop" token={typeof t === "string" ? t : ""} />
      </Container>
    </>
  );
}
