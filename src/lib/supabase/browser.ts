"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseConfig } from "@/lib/env";

export function createBrowserSupabase() {
  const { url, anonKey } = publicSupabaseConfig();
  return createBrowserClient(url, anonKey);
}
