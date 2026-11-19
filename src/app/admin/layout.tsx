import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/auth";
import { SignOutButton } from "./sign-out";
import { MarkOwnerDevice } from "./ignore-ip";
import { NotifyPrompt } from "@/components/notify-prompt";
import { optionalEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const ADMIN_NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/map", label: "Map" },
  { href: "/admin/history", label: "History" },
  { href: "/admin/geofences", label: "Geofences" },
  { href: "/admin/area-record", label: "Area record" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/journeys", label: "Journeys" },
  { href: "/admin/senders", label: "Senders" },
  { href: "/admin/venues", label: "Venues" },
  { href: "/admin/imports", label: "Imports" },
  { href: "/admin/settings", label: "Settings" },
];
const REVIEWER_NAV = ["/admin/geofences", "/admin/reports"];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { user, role } = await requirePageRole(["admin", "reviewer"]);
  const nav = role === "admin" ? ADMIN_NAV : ADMIN_NAV.filter((n) => REVIEWER_NAV.includes(n.href));
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <MarkOwnerDevice />
      <header className="sticky top-0 z-20 border-b border-border bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-2">
          <Link href="/admin" className="font-semibold">
            Full Transparency <span className="font-normal text-slate-400">· {role}</span>
          </Link>
          <div className="flex items-center gap-3 text-xs text-slate-300">
            <span className="hidden sm:inline">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
        <nav aria-label="Admin" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 pb-2 text-sm">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded px-2.5 py-1.5 hover:bg-slate-700">
              {n.label}
            </Link>
          ))}
          <Link href="/" className="ml-auto whitespace-nowrap rounded px-2.5 py-1.5 text-slate-400 hover:bg-slate-700">
            Public site ↗
          </Link>
        </nav>
      </header>
      {role === "admin" && <NotifyPrompt compact target="admin" vapidPublicKey={optionalEnv("VAPID_PUBLIC_KEY") ?? null} />}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
