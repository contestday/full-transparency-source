import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Container, Icon, IconTile, PageHead, type IconName } from "@/components/design";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How watching an area stays anonymous, what is and isn't stored, and how you can check it yourself.",
};

/** The public copy of this site's code (scripts/publish-public.mjs keeps it up to date). */
const SOURCE = process.env.NEXT_PUBLIC_SOURCE_URL || "https://github.com/contestday/full-transparency-source";

function Code({ path, children }: { path: string; children?: ReactNode }) {
  const label = children ?? path;
  return SOURCE ? (
    <a className="font-mono text-[13px] text-accent underline" href={`${SOURCE}/blob/main/${path}`} target="_blank" rel="noopener noreferrer">
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <code className="font-mono text-[13px]">{label}</code>
  );
}

/** An accordion item (native <details>: keyboard and screen-reader friendly). */
function Section({ icon, title, summary, children, open = false }: { icon: IconName; title: string; summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details
      open={open}
      className="group rounded-[var(--ft-radius-card)] border border-border bg-surface shadow-[var(--ft-shadow-card)] open:shadow-[0_14px_36px_rgb(20_43_73/12%)]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-4 p-5 sm:p-6 [&::-webkit-details-marker]:hidden">
        <IconTile name={icon} />
        <span className="min-w-0 flex-1">
          <span className="block text-[19px] font-bold leading-snug sm:text-[21px]">{title}</span>
          <span className="block text-[15px] text-muted">{summary}</span>
        </span>
        <Icon name="chevron" className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-3 border-t border-hairline px-5 pb-6 pt-5 text-[16px] leading-relaxed sm:px-6 sm:pl-[88px]">{children}</div>
    </details>
  );
}

const STORED: [string, string][] = [
  ["A scrambled form of your link's key", "A one-way SHA-256 hash. It lets us recognise your link when you open it, but cannot be turned back into the link."],
  ["The areas you drew", "Their shape, and the optional name or note you typed. Your Locations are locked to your link: only you can read them."],
  ["A dated record of your Wish and Want areas", "When each one came into effect and when it was changed or removed, so it's clear what I had been told, and from when. Redrawing an area makes a new area from that moment, and the old one is kept as ended at the same moment. It records what was set and when, never who set it. Nothing counts from before 18 November 2026, 20:00 GMT."],
  ["A random watcher number", "For example #4827, chosen at random from 1000 to 9999, so it reveals nothing about how many watchers there are. It is a label only, not a login."],
  ["A scrambled form of your IP address", "A salted one-way hash, used only to slow down abuse and, if needed, to block a sender who misuses the site. It cannot be turned back into your address."],
  ["The country you submitted from", "Two letters such as GB, as reported by our host for your request. Used only to spot and refuse misuse."],
  ["Your device's push address (only if you turn notifications on)", "An address issued by your browser's push service for this site. It does not contain your name, number or email."],
  ["Report contacts (only if you add them)", "Email addresses you choose for automatic reports, e.g. a solicitor. Each address gets nothing until its owner confirms, and every report has a stop link."],
];

const NEVER: string[] = [
  "Your name",
  "Your email address (unless you add it yourself as a report contact)",
  "Your phone number",
  "Your home address or postcode (unless you choose to type one into an area's name)",
  "Your IP address in readable form",
  "Your location: we never ask your device where you are",
  "Cookies to identify or track you",
];

export default function PrivacyPolicyPage() {
  return (
    <>
      <PageHead
        title="Privacy policy"
        art="geofence"
        lead="If you watch an area, you stay anonymous: no name, no email, no account. Here's exactly how, and how you can check it for yourself."
      />
      <Container className="max-w-4xl space-y-4 pb-20 pt-8">
        <section className="rounded-[var(--ft-radius-card)] bg-mint p-6 sm:p-8">
          <h2 className="text-[22px] font-bold text-[#005843]">The short version</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              "No sign-up, no name, no email, no phone number.",
              "Your private link is your key. We keep only a scrambled form of it.",
              "“Email it to myself” never reaches this site: it opens your own email app.",
              "Your device remembers your link, without a cookie.",
              "Other watchers never see your areas. I see Wish and Want areas, not who set them. Only you see your Locations.",
              "The code is published, so anyone can check these promises.",
            ].map((t) => (
              <li key={t} className="flex gap-2 text-[16px] text-[#00402F]">
                <Icon name="check" className="mt-0.5 text-jade" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>

        <Section icon="eye" title="What happens when you watch an area" summary="Step by step, from drawing an area to opening your link.">
          <ol className="list-decimal space-y-2 pl-5">
            <li>You search for a place or draw an area. You don&apos;t give a name or email.</li>
            <li>
              Your browser sends the area&apos;s shape to this site. The site creates a long random key (24 characters) and
              gives you a private link containing it: <span className="font-mono text-[13px]">/watch/XXXXXXXXXXXXXXXXXXXXXXXX</span>.
            </li>
            <li>
              The site stores only a <strong>one-way hash</strong> of that key, a fingerprint that can confirm a key is
              right but can&apos;t be reversed to recreate it. Your link exists only on your side.
            </li>
            <li>
              When you open your link, the site checks the fingerprint and shows the live marker coloured against
              <em> your</em> areas: amber in a Wish area, red in a Want area, purple at a Location.
            </li>
          </ol>
          <p className="text-sm text-muted">
            Code: <Code path="src/lib/watchers.ts" /> (creating and checking links) and <Code path="src/lib/crypto.ts" /> (the
            random key and the hash).
          </p>
        </Section>

        <Section icon="lock" title="What is stored, and what never is" summary="The complete list, with nothing left out.">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 font-bold">Stored</h3>
              <ul className="space-y-3">
                {STORED.map(([t, d]) => (
                  <li key={t}>
                    <span className="block font-semibold">{t}</span>
                    <span className="block text-sm text-muted">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 font-bold">Never stored</h3>
              <ul className="space-y-2">
                {NEVER.map((t) => (
                  <li key={t} className="flex gap-2">
                    <Icon name="close" className="mt-0.5 h-4 w-4 text-[#C62828]" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-sm text-muted">
            The database structure is public: see the <Code path="supabase/migrations/20261117000005_watchers.sql">watchers table</Code>.
            It has no column for a name, email or phone number, and an automated test fails if one is ever added (
            <Code path="tests/unit/security-static.test.ts" />).
          </p>
        </Section>

        <Section icon="chat" title="Keeping your link: email, share, QR code" summary="All three happen on your device. We never see your email address.">
          <p>
            Your link is the only key, and we can&apos;t recover it for you, so it&apos;s worth keeping a copy. Every option
            happens <strong>on your own device</strong>:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Email it to myself</strong> opens <em>your</em> email app with the link already written. You type your
              own address and send it from your account to yourself. This site never receives the address. The button is a
              plain <span className="font-mono text-[13px]">mailto:</span> link.
            </li>
            <li>
              <strong>Save or share</strong> opens your phone&apos;s own share menu (Notes, Messages, a password manager…).
            </li>
            <li>
              <strong>QR code</strong> is drawn in your browser. Nothing is sent anywhere.
            </li>
          </ul>
          <p className="text-sm text-muted">
            Code: <Code path="src/components/save-watch-link.tsx" />. An automated test checks that this file can&apos;t
            contact our server.
          </p>
          <p className="text-sm">
            <strong>One honest note:</strong> if you email the link to yourself, your own email provider handles that
            message, as with any email you send. That is outside this site. If you&apos;d rather avoid it, use Share, the
            QR code, or install the watch view as an app.
          </p>
        </Section>

        <Section icon="home" title="Remembered on your device, without cookies" summary="How the home page knows your view next time.">
          <p>
            When you set up areas, your browser keeps your link in its own <strong>local storage</strong> on your device.
            Unlike a cookie, it isn&apos;t sent to this site with every visit, and nobody else can read it. The home page
            uses it to show <em>your</em> view, with your watcher number, the next time you visit.
          </p>
          <p>
            Clear your browser&apos;s data for this site and it&apos;s forgotten. On another phone, open your link once (or
            install the watch view as an app) and it&apos;s remembered there too.
          </p>
          <p className="text-sm text-muted">
            Code: <Code path="src/lib/watch-links.ts" />.
          </p>
        </Section>

        <Section icon="bell" title="Notifications (optional)" summary="What a push notification needs, and what it doesn’t.">
          <p>
            If you turn on notifications, your browser gives this site a push address for your device, issued by Google,
            Apple or Mozilla depending on your browser. It lets us send &ldquo;area entered&rdquo; and &ldquo;area left&rdquo;
            alerts. It contains no name, number or email. Messages name your area&apos;s reference and the time, never a
            location.
          </p>
        </Section>

        <Section icon="chat" title="Automatic reports to contacts you choose" summary="Optional. Emails, never phone calls, and only to addresses that confirm.">
          <p>
            On your watch page you can add up to five email addresses, for example a solicitor or someone you trust. Each address
            receives a confirmation email first and gets nothing more unless its owner confirms. After that, it receives a short,
            factual email each time the GPS record shows entry into one of your areas, with a link to stop at any time.
          </p>
          <p>
            Those addresses are stored so the reports can be sent. If you add your own address, the site can link it to your watch
            link, so you would no longer be fully anonymous. Nothing on this site phones 999 or 101: only a person can.
          </p>
          <p className="text-sm text-muted">
            Code: <Code path="src/lib/watcher-contacts.ts" /> and <Code path="src/lib/incident-contacts.ts" />.
          </p>
        </Section>

        <Section icon="info" title="What I, the owner, can see" summary="The shape of an area and when it was set up. Never who set it up.">
          <p>
            I can see <strong>that an area was set up, its shape, and when</strong>. That&apos;s needed to work out the
            colours, and to remove areas that are clearly abusive. I can&apos;t see who set it up: there&apos;s no name,
            email or readable IP address to see. Your watcher number is random and tells me nothing about you.
          </p>
          <p>
            I can switch a watch link off if it&apos;s being misused, for example areas drawn around many private homes. That
            stops the link working and archives its areas.
          </p>
        </Section>

        <Section icon="layers" title="Other services, plainly" summary="Hosting, maps, place search and anonymous messaging.">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Hosting</strong> (Vercel) and the <strong>database</strong> (Supabase) run the site. Like any web
              host, Vercel keeps short-lived technical request logs. This site stores none of it.
            </li>
            <li>
              <strong>Maps</strong> are drawn from OpenFreeMap tiles, which your browser downloads directly, as with any
              online map.
            </li>
            <li>
              <strong>Searching for a place</strong> is passed on by this site to postcodes.io or OpenStreetMap. Your IP
              address is not forwarded with it.
            </li>
            <li>
              <strong>Incogneato</strong>, the anonymous messaging service, loads only on the Contact page.
            </li>
            <li>
              <strong>Visitor counts</strong> come from Vercel Web Analytics: which pages are viewed, the referring site,
              and country and device type. It uses no cookies, and Vercel counts visitors with a daily-changing anonymous
              hash rather than keeping your IP address. Private links are stripped before anything is sent: a watch link is
              counted only as &ldquo;/watch/[link]&rdquo;, never with its key (
              <Code path="src/lib/analytics-redact.ts" />
              ).
            </li>
            <li>
              <strong>An anonymous journey log</strong> helps me see where the site is confusing: the pages viewed in a visit,
              the buttons and links tapped (their labels, never anything you type), error messages shown, the time and your
              country. Each visit gets a random ID that is forgotten when you close the tab, so visits can&apos;t be linked to each
              other or to you. Watch links, your search results and your area names are never recorded. Entries are deleted after
              30 days (
              <Code path="src/components/journey-tracker.tsx" />
              ).
            </li>
          </ul>
        </Section>

        <Section icon="check" title="Check it yourself" summary="Read the code, and watch your browser’s network tab." open>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <strong>Read the code.</strong>{" "}
              {SOURCE ? (
                <>
                  The full source is published at{" "}
                  <a className="text-accent underline" href={SOURCE} target="_blank" rel="noopener noreferrer">
                    {SOURCE.replace(/^https?:\/\//, "")}
                  </a>
                  . The files named on this page are the ones that matter.
                </>
              ) : (
                "The full source code is being published; a link will appear here."
              )}
            </li>
            <li>
              <strong>Watch the network.</strong> On a computer, open your browser&apos;s developer tools (F12), go to the
              Network tab, and press &ldquo;Email it to myself&rdquo;, &ldquo;Save or share&rdquo; or &ldquo;QR code&rdquo;. You&apos;ll
              see no request to this site.
            </li>
            <li>
              <strong>Look for cookies.</strong> In the same tools, under Application → Cookies, you&apos;ll find no
              tracking cookie for watchers.
            </li>
          </ol>
        </Section>

        <p className="text-center text-sm text-muted">
          Questions about privacy?{" "}
          <Link className="text-accent underline" href="/report">
            Ask me anonymously
          </Link>
          .
        </p>
      </Container>
    </>
  );
}
