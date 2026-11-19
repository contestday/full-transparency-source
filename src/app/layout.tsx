import type { Metadata, Viewport } from "next";
import { DM_Sans, Inter } from "next/font/google";
import "./ft-tokens.css";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/pwa";
import { SiteAnalytics } from "@/components/analytics";
import { INSTALL_PROMPT_CAPTURE } from "@/lib/pwa-install";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], weight: ["500", "700"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL || "http://localhost:3000"),
  title: {
    default: "Full Transparency",
    template: "%s · Full Transparency",
  },
  description:
    "Full Transparency: published movement history, upcoming plans and a live status marker.",
  applicationName: "Full Transparency",
  manifest: "/full-transparency/pwa/manifest.webmanifest",
  icons: { apple: "/full-transparency/pwa/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Full Transparency", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#245AD6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${inter.variable} ${dmSans.variable} h-full antialiased`}>
      <head>
        {/* Catch Chrome's install prompt before the page's scripts load. */}
        <script dangerouslySetInnerHTML={{ __html: INSTALL_PROMPT_CAPTURE }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <ServiceWorkerRegister />
        <SiteAnalytics />
      </body>
    </html>
  );
}
