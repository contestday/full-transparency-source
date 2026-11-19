"use client";

import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-700"
      onClick={async () => {
        await createBrowserSupabase().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
