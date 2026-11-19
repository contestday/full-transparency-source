import type { Metadata } from "next";
import Link from "next/link";
import { Container, IconTile, PageHead } from "@/components/design";
import { IncogneatoWidget } from "@/components/incogneato-widget";
import { ReportForm } from "./report-form";

export const metadata: Metadata = { title: "Contact" };

const INCOGNEATO_URL = process.env.NEXT_PUBLIC_INCOGNEATO_URL;
const INCOGNEATO_BOX = process.env.NEXT_PUBLIC_INCOGNEATO_BOX;

const card = "rounded-[var(--ft-radius-card)] border border-border bg-surface p-6 shadow-[var(--ft-shadow-card)] sm:p-8";

export default function ContactPage() {
  return (
    <>
      <PageHead eyebrow="Contact" title="Get in touch" lead="Questions, corrections, feedback or anything else. You don't need to give your name." />
      <Container className="max-w-4xl space-y-6 pb-20 pt-8 text-[16px] leading-relaxed">
        <div className="grid gap-6">
          {INCOGNEATO_URL && (
            <section className={`${card} flex flex-col gap-3`}>
              <IconTile name="chat" tone="mint" />
              <h2 className="text-[22px] font-bold">Message me anonymously</h2>
              <p className="text-muted">
                Through Incogneato: no account needed. I can reply on my Incogneato page, so others may see the question and
                my answer, but never who asked.
              </p>
              <a
                href={INCOGNEATO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto inline-flex h-12 w-fit items-center rounded-[var(--ft-radius-control)] bg-jade px-5 font-semibold text-white hover:brightness-95"
              >
                Open my Incogneato page ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
              <p className="text-sm text-muted">A separate service with its own privacy policy.</p>
            </section>
          )}
        </div>

        <section id="note" className={`${card} scroll-mt-24`}>
          <div className="mb-4 flex items-center gap-3">
            <IconTile name="lock" />
            <h2 className="text-[22px] font-bold">Send private note</h2>
          </div>
          <p className="mb-4 text-muted">Only I can read it. Leave contact details only if you&apos;d like a private reply.</p>
          <ReportForm />
        </section>

        <p className="text-muted">
          Want to keep an eye on a particular place? You don&apos;t need to message me: use{" "}
          <Link className="font-semibold text-accent underline" href="/geofences/submit">
            Set Up Geofences
          </Link>
          . See{" "}
          <Link className="font-semibold text-accent underline" href="/privacy">
            Privacy
          </Link>{" "}
          for exactly what is and isn&apos;t kept.
        </p>

        {INCOGNEATO_BOX && <IncogneatoWidget box={INCOGNEATO_BOX} />}
      </Container>
    </>
  );
}
