import type { Metadata } from "next";
import { Container, PageHead } from "@/components/design";
import { ContactAction } from "../contact-action";

export const metadata: Metadata = { title: "Confirm automatic reports", robots: { index: false } };

export default async function Page({ searchParams }: PageProps<"/contacts/confirm">) {
  const t = (await searchParams).t;
  return (
    <>
      <PageHead eyebrow="Automatic reports" title="Confirm automatic reports" lead="An anonymous watcher of this site asked for reports to be emailed to you. They start only if you confirm." />
      <Container className="max-w-2xl pb-20 pt-8">
        <ContactAction action="confirm" token={typeof t === "string" ? t : ""} />
      </Container>
    </>
  );
}
