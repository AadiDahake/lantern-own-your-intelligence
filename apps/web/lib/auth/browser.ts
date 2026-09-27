import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The anon-key client the sign-in screen and the account menu use.
 *
 * The two variables are written out literally rather than looked up by name, because Next only
 * inlines `process.env.NEXT_PUBLIC_*` into the browser bundle when it can see the property access.
 */
let cached: SupabaseClient | null = null;

export function browserSupabase(): SupabaseClient {
  if (cached) return cached;
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  );
  return cached;
}
