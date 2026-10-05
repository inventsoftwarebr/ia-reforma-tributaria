"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Cliente Supabase para Client Component. Só a chave publicável aqui. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
