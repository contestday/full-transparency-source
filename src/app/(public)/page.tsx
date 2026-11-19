import Link from "next/link";
import { Artwork } from "@/components/brand";
import { CardLink, Container, Icon } from "@/components/design";
import { LiveStatusCard } from "@/components/live-status-card";
import { getPublicLiveStatus, getPublicPlans, type PublicLiveStatus } from "@/lib/public-data";
import { fmtDate } from "@/lib/format";
import { SampleAlertsPrompt } from "@/components/sample-alerts-prompt";
import { loadSampleWatcher } from "@/lib/sample-watcher";
import { loadHomeArea } from "@/lib/home";

export const dynamic = "force-dynamic";

/** Why I publish this: the first thing anyone reads. (Draft: the owner to confirm the wording.) */
const WHY = "I publish where I go so that anyone who's concerned can check for themselves, rather than take my word for it.";

export default async function HomePage() {
  let live: PublicLiveStatus | null = null;
  let nextPlan: { title: string; starts_at: string } | null = null;
  const sample = await loadSampleWatcher().catch(() => null);
  const sampleToken = sample?.locked ? sample.token : null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [l, plans, home_area] = await Promise.all([getPublicLiveStatus(), getPublicPlans({ from: `${today}T00:00:00Z` }), loadHomeArea().catch(() => null)]);
    live = { ...l, home_area };
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
            <p className="mt-4 text-[17px] leading-relaxed text-ink sm:text-lg">{WHY}</p>
            <p className="mt-2 text-[15px] text-muted">Where I&apos;ve been, where I&apos;m going, and where I am now.</p>
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
        <SampleAlertsPrompt sampleToken={sampleToken} />
        <section>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-[26px] font-bold sm:text-[32px]">Explore</h2>
            <Link href="/about" className="text-sm font-semibold text-accent hover:underline">
              FAQs →
            </Link>
          </div>
          <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
            <CardLink href="/history" icon="history" title="History" text="Where I've been, on a map." footer="Updated every few minutes" />
            <CardLink
              href="/plans"
              icon="calendar"
              title="Plans"
              text="What I plan to do."
              footer={nextPlan ? `Next: ${fmtDate(nextPlan.starts_at, { dateStyle: undefined, weekday: "short", day: "numeric", month: "short" })}` : "Nothing planned yet"}
            />
            <CardLink href="/geofences/submit" icon="eye" title="Watch" text="Get told if I go somewhere that matters to you." footer="Private, no account" />
            <CardLink href="/sample" icon="layers" title="Sample" text="Try a watcher's view." footer="Read-only example" />
            <CardLink href="/report" icon="chat" title="Message" text="Message me anonymously." footer="Only I read it" />
          </div>
        </section>

      </Container>
    </>
  );
}
