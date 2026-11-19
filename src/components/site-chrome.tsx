import Link from "next/link";
import { Logo } from "@/components/brand";
import { Container } from "@/components/design";

export { SiteHeader } from "@/components/site-header";

export function SiteFooter() {
  const link = "inline-flex min-h-11 items-center text-[#DCE7F3] hover:text-white hover:underline";
  return (
    <footer className="mt-auto bg-navy text-[#DCE7F3]">
      <Container className="grid gap-8 py-12 md:grid-cols-[2fr_1fr_1fr]">
        <div className="space-y-3">
          <Logo variant="reverse" className="h-9 w-auto" />
          <p className="max-w-md text-sm leading-relaxed text-[#9FB4C9]">
            Location records show what a GPS source reported at a time. On their own they don&apos;t prove who carried
            the device or whether anything happened.
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[.08em] text-[#9FB4C9]">Explore</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 text-sm md:grid-cols-1">
            <li><Link className={link} href="/history">Public History</Link></li>
            <li><Link className={link} href="/plans">Upcoming Plans</Link></li>
            <li><Link className={link} href="/geofences/submit">Set Up Geofences</Link></li>
            <li><Link className={link} href="/watch">Your Geofences</Link></li>
            <li><Link className={link} href="/sample">Sample Geofence View (Live)</Link></li>
            <li><Link className={link} href="/admin">Owner sign-in</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[.08em] text-[#9FB4C9]">Policy</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 text-sm md:grid-cols-1">
            <li><Link className={link} href="/privacy">Privacy &amp; anonymity</Link></li>
            <li><Link className={link} href="/about">About &amp; publication policy</Link></li>
            <li><Link className={link} href="/report">Contact</Link></li>
          </ul>
        </div>
      </Container>
      <div className="border-t border-white/10">
        <Container className="flex flex-wrap items-center justify-between gap-2 py-4 text-xs text-[#9FB4C9]">
          <span>Full Transparency</span>
          <Link className="hover:text-white hover:underline" href="/login">
            Staff sign-in
          </Link>
        </Container>
      </div>
    </footer>
  );
}
