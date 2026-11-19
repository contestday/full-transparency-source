import Link from "next/link";
import { Container, Icon, type IconName } from "@/components/design";
import { LiveStatusCard } from "@/components/live-status-card";
import type { WeekDay } from "@/components/week-strip";
import { getPublicHistory, getPublicLiveStatus, getPublicPlans, type PublicLiveStatus } from "@/lib/public-data";
import { fmtDate, londonDayKey } from "@/lib/format";
import { SampleAlertsPrompt } from "@/components/sample-alerts-prompt";
import { loadSampleWatcher } from "@/lib/sample-watcher";
import { loadHomeArea } from "@/lib/home";
import { colourHistory, loadPublicZoneContext } from "@/lib/zones";
import { shiftDay, weekStart } from "@/lib/history-range";

export const dynamic = "force-dynamic";

/** Why I publish this: the first thing anyone reads (the owner's own words). */
const WHY = "I publish where I go so that anyone who's concerned can check for themselves, rather than take my word for it.";

/** This week's published stay time per day, by everyone's colour (green / yellow / red). */
async function loadWeek(today: string): Promise<WeekDay[]> {
  const monday = weekStart(today);
  const days: WeekDay[] = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ date: shiftDay(monday, i), green: 0, yellow: 0, red: 0 }));
  const [h, zctx] = await Promise.all([getPublicHistory(`${monday}T00:00:00Z`, new Date().toISOString(), { stopsOnly: true }), loadPublicZoneContext()]);
  const { stopZones } = colourHistory(h.records, zctx);
  for (const r of h.records) {
    if (r.kind !== "visit" || !r.observed_until) continue;
    const day = days.find((d) => d.date === londonDayKey(r.observed_at));
    const mins = Math.round((Date.parse(r.observed_until) - Date.parse(r.observed_at)) / 60_000);
    const z = stopZones[r.id];
    if (day && mins > 0 && z) day[z] += mins;
  }
  return days;
}

function Tile({ href, icon, title, text, footer, dark = false, wide = false }: { href: string; icon: IconName; title: string; text: string; footer?: string; dark?: boolean; wide?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex gap-2 rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgb(20_43_73/10%)] ${
        wide ? "col-span-2 flex-row items-center gap-3" : "flex-col"
      } ${dark ? "border-navy bg-navy text-white" : "border-hairline bg-white text-ink"}`}
    >
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${dark ? "bg-navy-2 text-signal" : "bg-blue-100 text-accent"}`}>
        <Icon name={icon} />
      </span>
      <span className={wide ? "flex-1" : "contents"}>
        <span className="block font-bold">{title}</span>
        <span className={`block text-[13px] leading-snug ${dark ? "text-[#DCE7F3]" : "text-muted"}`}>{text}</span>
        {footer && <span className={`block text-xs font-semibold ${dark ? "text-signal" : "text-[#1947B5]"}`}>{footer}</span>}
      </span>
      {wide && <Icon name="chevron" className="text-muted" />}
    </Link>
  );
}

export default async function HomePage() {
  let live: PublicLiveStatus | null = null;
  let nextPlan: { title: string; starts_at: string } | null = null;
  let week: WeekDay[] | undefined;
  const today = londonDayKey(new Date().toISOString());
  const sample = await loadSampleWatcher().catch(() => null);
  const sampleToken = sample?.locked ? sample.token : null;
  try {
    const [l, plans, home_area, w] = await Promise.all([
      getPublicLiveStatus(),
      getPublicPlans({ from: `${new Date().toISOString().slice(0, 10)}T00:00:00Z` }),
      loadHomeArea().catch(() => null),
      loadWeek(today).catch(() => undefined),
    ]);
    live = { ...l, home_area };
    nextPlan = plans.find((p) => p.status !== "cancelled") ?? null;
    week = w;
  } catch (err) {
    console.error(err);
  }

  return (
    <>
      <section className="relative overflow-hidden bg-sky">
        {/* A soft route and pins: decoration only. */}
        <svg viewBox="0 0 390 200" className="pointer-events-none absolute -right-10 -top-2 h-40 w-[300px] opacity-60 lg:right-8 lg:top-6 lg:h-64 lg:w-[480px]" aria-hidden="true">
          <path d="M10 150c60-40 90 10 150-20s80-90 150-60 60 40 80 30" fill="none" stroke="#BCD0F5" strokeWidth="10" strokeLinecap="round" />
          <circle cx="310" cy="70" r="9" fill="#7BF0BA" />
          <circle cx="160" cy="130" r="6" fill="#245AD6" />
        </svg>
        <Container className="relative grid items-start gap-6 pb-20 pt-6 sm:pt-12 lg:grid-cols-12 lg:gap-10 lg:pb-14">
          <div className="lg:col-span-5 lg:pt-6">
            <p className="text-xs font-bold uppercase tracking-[.08em] text-muted">Open by choice</p>
            <h1 className="mt-1 text-[30px] font-bold leading-[1.08] sm:text-[56px] sm:leading-[1.04]">Full Transparency</h1>
            <p className="mt-3 text-[17px] leading-relaxed text-ink sm:text-lg">{WHY}</p>
            <Link
              href="/history"
              className="mt-6 hidden h-12 items-center gap-2 rounded-xl bg-accent px-5 font-semibold text-white hover:bg-accent-hover lg:inline-flex"
            >
              <Icon name="history" /> See my history
            </Link>
          </div>
          <div className="hidden lg:col-span-7 lg:block">{live && <LiveStatusCard initial={live} week={week} today={today} />}</div>
        </Container>
      </section>

      <Container className="relative -mt-16 space-y-5 pb-16 lg:mt-10">
        {/* Phones: the status card overlaps the hero, then one main action. */}
        <div className="lg:hidden">{live && <LiveStatusCard initial={live} week={week} today={today} />}</div>
        <Link href="/history" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-white hover:bg-accent-hover lg:hidden">
          <Icon name="history" /> See my history
        </Link>

        <SampleAlertsPrompt sampleToken={sampleToken} />

        <section className="space-y-3 pt-3">
          <div className="flex items-end justify-between gap-2">
            <h2 className="text-[22px] font-bold sm:text-[28px]">Explore</h2>
            <Link href="/about" className="text-sm font-semibold text-accent hover:underline">
              FAQs →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-5">
            <Tile href="/history" icon="history" title="History" text="Where I've been, on a map." footer="Updated every few minutes" />
            <Tile
              href="/plans"
              icon="calendar"
              title="Plans"
              text="What I plan to do."
              footer={nextPlan ? `Next: ${fmtDate(nextPlan.starts_at, { dateStyle: undefined, weekday: "short", day: "numeric", month: "short" })}` : "Nothing planned yet"}
            />
            <Tile href="/geofences/submit" icon="pin" title="Watch" text="Get told if I go somewhere that matters to you." footer="Private, no account" dark />
            <Tile href="/sample" icon="layers" title="Sample" text="Try a watcher's view." footer="Read-only example" />
            <div className="col-span-2 lg:col-span-1">
              <Tile href="/report" icon="chat" title="Message" text="Message me anonymously. Only I read it." />
            </div>
          </div>
        </section>
      </Container>
    </>
  );
}
