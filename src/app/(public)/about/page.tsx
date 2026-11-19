import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Container, Icon, PageHead } from "@/components/design";

export const metadata: Metadata = { title: "FAQs" };

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "What is this?",
    a: "A voluntary, public record of where I go: my GPS history, my plans and, right now, whether I'm within my usual area.",
  },
  {
    q: "What do the colours mean?",
    a: (
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>Green:</strong> within my okay zone around home.</li>
        <li><strong>Yellow:</strong> outside it.</li>
        <li><strong>Red:</strong> in one of my noted areas.</li>
        <li><strong>Amber, red, purple:</strong> only on a watcher&apos;s own link: their Wish, Want and Location areas.</li>
        <li><strong>Grey:</strong> no recent GPS update.</li>
      </ul>
    ),
  },
  {
    q: "What isn't shown?",
    a: "Anything inside my home area. Movement there is never published, though the area itself is shown on the maps.",
  },
  {
    q: "How exact is it?",
    a: "History shows the recorded GPS positions. Public places (pubs, shops) are named in full; private addresses only by street or area. The live marker shows a small square.",
  },
  {
    q: "Does GPS prove where I was?",
    a: "It shows what the phone reported, and when. It doesn't prove who carried it, and GPS can be delayed or inaccurate.",
  },
  {
    q: "What's a plan?",
    a: "Something I intend to do. It isn't a record. Where GPS matches a plan, that's shown separately.",
  },
  {
    q: "What are Wish, Want and Location areas?",
    a: (
      <>
        Places someone would rather I didn&apos;t go (Wish), has asked me not to go (Want), or wants a private warning about (Location). They&apos;re
        set anonymously and aren&apos;t legal restrictions. <Link className="text-accent underline" href="/geofences/submit">Set one up</Link>.
      </>
    ),
  },
  {
    q: "Is watching anonymous?",
    a: (
      <>
        Yes: no name, email or account. <Link className="text-accent underline" href="/privacy">Privacy</Link>.
      </>
    ),
  },
  {
    q: "Can publication stop?",
    a: "It can be paused, and single records withdrawn. Times are to the minute, and each record shows when it was published.",
  },
  {
    q: "How do I contact you?",
    a: (
      <>
        Anonymously, from the <Link className="text-accent underline" href="/report">Contact</Link> page. Only I read it.
      </>
    ),
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHead title="Questions and answers" />
      <Container className="max-w-3xl space-y-3 pb-20 pt-6">
        {FAQS.map((f, i) => (
          <details key={f.q} open={i === 0} className="group rounded-[var(--ft-radius-card)] border border-border bg-surface">
            <summary className="flex cursor-pointer list-none items-center gap-3 p-4 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
              <span className="flex-1">{f.q}</span>
              <Icon name="chevron" className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-hairline px-4 pb-4 pt-3 text-[16px] leading-relaxed">{f.a}</div>
          </details>
        ))}
      </Container>
    </>
  );
}
