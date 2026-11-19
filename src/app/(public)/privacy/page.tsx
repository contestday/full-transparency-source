import type { Metadata } from "next";
import Link from "next/link";
import { Container, Icon, PageHead } from "@/components/design";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Watching an area is anonymous: no name, email or account.",
};

const ESSENTIALS = [
  "No sign-up: no name, email or phone number.",
  "Your private link is your key. Only a scrambled form of it is stored.",
  "Other watchers never see your areas. I see Wish and Want areas, not who set them. Only you see your Locations.",
  "Your IP address isn't stored.",
  "Nothing near my home is ever published.",
  "The code is public, so anyone can check.",
];

export default function PrivacyPage() {
  return (
    <>
      <PageHead title="Your privacy" lead="Watching is anonymous." art="geofence" />
      <Container className="max-w-3xl space-y-6 pb-20 pt-6">
        <ul className="space-y-3 rounded-[var(--ft-radius-card)] bg-mint p-6 sm:p-8">
          {ESSENTIALS.map((t) => (
            <li key={t} className="flex gap-2 text-[17px] text-[#00402F]">
              <Icon name="check" className="mt-0.5 text-jade" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <Link
          href="/privacy/policy"
          className="inline-flex h-12 items-center gap-2 rounded-[var(--ft-radius-control)] border border-border bg-white px-5 font-semibold hover:bg-sky"
        >
          Full privacy policy <Icon name="chevron" className="h-4 w-4" />
        </Link>
      </Container>
    </>
  );
}
