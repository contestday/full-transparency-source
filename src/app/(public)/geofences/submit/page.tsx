import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHead } from "@/components/design";
import { InfoButton } from "@/components/info-button";
import { GeofenceSubmitForm } from "./submit-form";

export const metadata: Metadata = { title: "Set Up Geofences" };

export default function GeofenceSubmitPage() {
  return (
    <>
      <PageHead
        eyebrow="Set Up Geofences"
        title="Watch an area"
        art="geofence"
        lead="Choose the places that matter to you and get a private link that shows me in your own colours. No name or account needed. Only you, and anyone you share your link with, can see your areas."
      />
      <Container className="space-y-5 pb-20 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <InfoButton label="How it works">
            <p>You get a private watch link. It shows my status, history and plans coloured for your areas; everyone else sees green or yellow.</p>
            <p>
              I&apos;m told about your Wish and Want areas, each from the date and time you set it. Your Locations are locked to your link:
              not even I can see them.
            </p>
            <p>Turn on notifications on your watch page to be told when I enter or leave your areas. Your areas are not legal restrictions.</p>
          </InfoButton>
          <p className="text-sm">
            Already have a link? <Link className="font-semibold text-accent underline" href="/watch">Your Geofences</Link>
          </p>
        </div>
        <GeofenceSubmitForm />
      </Container>
    </>
  );
}
