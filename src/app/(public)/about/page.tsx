import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { Container, PageHead } from "@/components/design";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <PageHead eyebrow="About" title="About Full Transparency" lead="Purpose, limitations and publication policy." />
      <Container className="max-w-3xl space-y-6 pb-20 pt-6">

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Purpose</h2>
        <p>
          Full Transparency is a voluntary, self-published record. It brings together GPS movement history, upcoming
          plans and a way for anyone to raise concerns confidentially.
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">What the different records mean</h2>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-semibold">Recorded history</dt>
            <dd>
              A GPS source (a FollowMee device or an imported Google Timeline file) reported a position at a time. It
              is evidence of what the device reported, not proof of who carried it, and not evidence that any incident
              did or did not occur.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Plans</dt>
            <dd>
              Proposed activities entered by hand. A plan is an intention, not a record. A completed plan is{" "}
              <em>not</em> a GPS-verified visit. Where GPS data matches a plan, that is shown separately.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Areas of concern</dt>
            <dd>
              Anonymous, unverified submissions from members of the public. They are private, not shown on this
              site, and are <strong>not</strong> police instructions, court orders, exclusion zones or legally
              binding restrictions.
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Live status marker</h2>
        <p className="text-sm">
          When it is switched on, the homepage shows a live, colour-coded status worked out automatically from the
          latest GPS position:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li><strong>Green:</strong> within the okay zone around home.</li>
          <li><strong>Yellow:</strong> outside the okay zone.</li>
          <li>
            <strong>Amber, red and purple</strong> are seen only by someone watching their own areas, on their private watch
            link: amber in one of their Wish areas, red in one of their Want areas and purple at one of their Locations.
            Nobody else sees them.
          </li>
          <li><strong>Grey:</strong> no recent GPS update.</li>
        </ul>
        <p className="text-sm">
          The marker shows an approximate area, not a precise position. Nothing is shown close to home. The shapes
          of areas of concern are never shown. Areas of concern are unverified submissions, not legal
          restrictions. The status reflects GPS data, which can be delayed or inaccurate.
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Publication policy</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong>Delay.</strong> The history map and timeline are published only after a fixed delay. The
            only live element is the status marker described above.
          </li>
          <li>
            <strong>Precision.</strong> The history shows the recorded GPS positions themselves: the route as recorded,
            and each stop at its place, named by venue or street. Only the live status marker is generalised to a small
            square.
          </li>
          <li>
            <strong>Exclusions.</strong> Nothing within the hidden zone around my home is ever published. Some
            categories, such as healthcare, are excluded too.
          </li>
          <li>
            <strong>Times.</strong> Published times are to the minute. Each record shows both the observed
            time and the time it was published.
          </li>
          <li>
            <strong>Venues and addresses.</strong> Public venues such as pubs, hotels and restaurants are shown in full,
            by name and location, in both plans and history. Private addresses are never shown. Only a general area
            or road is published for them.
          </li>
          <li>
            <strong>Withdrawal and pauses.</strong> Publication can be paused, and individual records can be
            withdrawn.
          </li>
        </ul>
      </Card>

      <Card className="space-y-3" id="watcher-privacy">
        <h2 className="text-lg font-semibold">Watching an area: what is and isn&apos;t kept</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong>No name, email or account.</strong> Your watch link contains a long random key. Only a scrambled form
            of it (a one-way hash) is stored, along with your areas and a random watcher number such as #4827, which is
            a label, not a login.
          </li>
          <li>
            <strong>&ldquo;Email it to myself&rdquo; never reaches this site.</strong> It opens your own email app with the
            link filled in; you send it from your account to yourself. Sharing and the QR code are also done on your
            device. You can check this in your browser&apos;s developer tools: pressing those buttons sends nothing to this
            website.
          </li>
          <li>
            <strong>Remembered on your device, not with a cookie.</strong> Your browser keeps your link in its own storage
            so the home page can show your view next time. Clear your browser data to forget it.
          </li>
          <li>
            <strong>Notifications are optional.</strong> If you turn them on, we store only the push address your browser
            provides for this site, which can&apos;t identify you.
          </li>
          <li>
            <strong>Your IP address is not stored.</strong> Only a salted, one-way hash of it is kept, to limit abuse; it
            can&apos;t be turned back into your address.
          </li>
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Contact</h2>
        <p className="text-sm">
          You can message me anonymously from the <Link className="text-accent underline" href="/report">Contact</Link>{" "}
          page. Messages are seen only by me.
        </p>
      </Card>
      </Container>
    </>
  );
}
