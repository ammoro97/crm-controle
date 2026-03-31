"use client";

import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const fallbackUrl = "https://placeholder.supabase.co";
const fallbackAnonKey = "public-anon-placeholder-key";

export const supabase = createBrowserClient(
  supabaseUrl || fallbackUrl,
  supabaseAnonKey || fallbackAnonKey,
);

if (typeof window !== "undefined" && (!supabaseUrl || !supabaseAnonKey)) {
  // eslint-disable-next-line no-console
  console.warn(
    "Supabase env ausente no ambiente atual. Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  );
}
