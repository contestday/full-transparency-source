import Link from "next/link";
import { Artwork } from "@/components/brand";
import { CardLink, Container, Icon } from "@/components/design";
import { LiveStatusCard } from "@/components/live-status-card";
import { InstallAppButton } from "@/components/pwa";
import { getPublicLiveStatus, getPublicPlans, type PublicLiveStatus } from "@/lib/public-data";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let live: PublicLiveStatus | null = null;
  let nextPlan: { title: string; starts_at: string } | null = null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [l, plans] = await Promise.all([getPublicLiveStatus(), getPublicPlans({ from: `${today}T00:00:00Z` })]);
    live = l;
    nextPlan = plans.find((p) => p.status !== "cancelled") ?? null;
  } catch (err) {
    console.error(err);
  }

  return (
    <>
      <section className="relative overflow-hidden border-b border-[#DCE7F3] bg-sky">
        <Container className="grid items-start gap-8 py-8 sm:py-14 lg:grid-cols-12">
          <div className="lg:col-span-5 lg:pt-6">
            <p className="text-xs font-bold uppercase tracking-[.08em] text-muted">Open by choice</p>
            <h1 className="mt-2 text-[34px] font-bold leading-[1.08] sm:text-[56px] sm:leading-[1.04]">Full Transparency</h1>
            <p className="mt-4 text-[17px] leading-relaxed text-muted sm:text-lg">
              Where I&apos;ve been, where I&apos;m going and, right now, whether I&apos;m within my usual area. Shared openly,
              with my home kept private.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/history" className="inline-flex h-12 items-center gap-2 rounded-[var(--ft-radius-control)] bg-accent px-5 font-semibold text-white hover:bg-accent-hover">
                <Icon name="history" /> See my history
              </Link>
              <Link href="/plans" className="inline-flex h-12 items-center gap-2 rounded-[var(--ft-radius-control)] border border-border bg-white px-5 font-semibold hover:bg-sky">
                <Icon name="calendar" /> Upcoming plans
              </Link>
            </div>
            <Artwork stem="hero" sizes="(min-width: 1024px) 420px, 100vw" className="mt-8 h-[150px] w-full rounded-[var(--ft-radius-card)] object-cover lg:h-auto" />
          </div>
          <div className="lg:col-span-7">{live && <LiveStatusCard initial={live} />}</div>
        </Container>
      </section>

      <Container className="space-y-14 pb-20 pt-12">
        <section className="flex flex-wrap items-center gap-5 rounded-[var(--ft-radius-card)] border-2 border-[#B45309] bg-[#FFF4D6] p-6 sm:p-8">
          <Icon name="bell" className="h-10 w-10 shrink-0 text-[#B45309]" />
          <div className="min-w-0 flex-1 basis-72 space-y-2">
            <h2 className="text-[24px] font-bold sm:text-[28px]">Try it: get the sample&apos;s real alerts</h2>
            <p className="text-[16px]">
              The sample watcher has real areas set up. Turn on sample alerts and your phone gets the same alerts a watcher would,
              as they happen, each clearly marked <strong>SAMPLE</strong>. Turn them off any time with one tap.
            </p>
          </div>
          <Link
            href="/sample#sample-alerts"
            className="inline-flex h-12 items-center gap-2 rounded-[var(--ft-radius-control)] bg-[#B45309] px-5 font-semibold text-white hover:brightness-95"
          >
            Open the sample <span aria-hidden="true">→</span>
          </Link>
        </section>
        <section>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-[26px] font-bold sm:text-[32px]">Explore</h2>
            <Link href="/about" className="text-sm font-semibold text-accent hover:underline">
              About this site and what&apos;s shown →
            </Link>
          </div>
          <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
            <CardLink href="/history" icon="history" title="Public History" text="Where I've been, on a map and timeline, including routes." footer="Updated every few minutes" />
            <CardLink
              href="/plans"
              icon="calendar"
              title="Upcoming Plans"
              text="Things I've planned, as a list, calendar or map."
              footer={nextPlan ? `Next: ${fmtDate(nextPlan.starts_at, { dateStyle: undefined, weekday: "short", day: "numeric", month: "short" })}` : "Nothing planned yet"}
            />
            <CardLink href="/geofences/submit" icon="eye" title="Set Up Geofences" text="Choose places that matter to you and see, privately, if I'm there." footer="Private link, no account" />
            <CardLink href="/sample" icon="layers" title="Sample Geofence View (Live)" text="See exactly what someone watching an area sees, compared with the public." footer="Read-only example" />
            <CardLink href="/report" icon="chat" title="Contact" text="Ask a question or send feedback, anonymously if you like." footer="Only I read it" />
          </div>
        </section>

        <section className="rounded-[var(--ft-radius-card)] bg-white p-6 sm:p-8">
          <h2 className="text-[22px] font-bold">How publication works</h2>
          <ol className="mt-5 grid gap-6 md:grid-cols-3">
            {[
              ["pin", "Recorded by GPS", "My phone reports its position every few minutes."],
              ["lock", "Home kept private", "Nothing near my home is ever shown. Everywhere else, the history shows the recorded GPS positions."],
              ["eye", "Published openly", "The live status, history and plans appear here for anyone to see."],
            ].map(([icon, title, text], i) => (
              <li key={title} className="flex gap-4">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-sky text-accent">
                  <Icon name={icon as "pin"} className="h-6 w-6" />
                </span>
                <span>
                  <span className="text-xs font-bold uppercase tracking-[.08em] text-muted">Step {i + 1}</span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--ft-radius-card)] border border-border bg-white p-6">
          <div>
            <h2 className="text-lg font-bold">Keep it on your home screen</h2>
            <p className="text-sm text-muted">Install Full Transparency as an app for quick access to the live status.</p>
          </div>
          <InstallAppButton />
        </section>
      </Container>
    </>
  );
}
