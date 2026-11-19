import type { Metadata } from "next";
import { optionalEnv } from "@/lib/env";
import { WatchView } from "./watch-view";

export async function generateMetadata({ params }: PageProps<"/watch/[token]">): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Your places",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    // Installing from here opens straight into this watch view.
    manifest: `/watch/${encodeURIComponent(token.toUpperCase())}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "Your places", statusBarStyle: "default" },
  };
}
export const dynamic = "force-dynamic";

export default async function WatchPage({ params }: PageProps<"/watch/[token]">) {
  const { token } = await params;
  return <WatchView token={token.toUpperCase()} vapidPublicKey={optionalEnv("VAPID_PUBLIC_KEY") ?? null} />;
}
