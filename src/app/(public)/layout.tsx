import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { InstallBanner } from "@/components/pwa";
import { NotifyPrompt } from "@/components/notify-prompt";
import { JourneyTracker } from "@/components/journey-tracker";
import { optionalEnv } from "@/lib/env";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      {/* Only when this device has a watch link saved (not on the watch page itself). */}
      <NotifyPrompt compact target="watch" vapidPublicKey={optionalEnv("VAPID_PUBLIC_KEY") ?? null} />
      {/* Pages lay out their own page-head band and content container. */}
      <main className="flex w-full flex-1 flex-col">{children}</main>
      <SiteFooter />
      <InstallBanner />
      <JourneyTracker />
    </>
  );
}
