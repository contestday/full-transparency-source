import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHead } from "@/components/design";
import { InfoButton } from "@/components/info-button";
import { GeofenceSubmitForm } from "./submit-form";

export const metadata: Metadata = { title: "Watch" };

export default function GeofenceSubmitPage() {
  return (
    <>
      <PageHead
        title="Watch a place"
        art="geofence"
        lead="Pick places that matter to you. Get a private watch link. No name or account."
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
            Already have a link? <Link className="font-semibold text-accent underline" href="/watch">Your places</Link>
          </p>
        </div>
        <GeofenceSubmitForm />
      </Container>
    </>
  );
}
