import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/** What the console shows about whoever is signed in. */
export type Account = {
  id: string;
  email: string;
  company: string | null;
};

function publicUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
}

function publicAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

/**
 * A Supabase client bound to the request's session cookies.
 *
 * Server components cannot write cookies, so `setAll` swallows the refresh write. The middleware
 * runs on every console request and refreshes the cookie there, which is where the write lands.
 */
export async function serverSupabase(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(publicUrl(), publicAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a server component: the middleware already refreshed the session.
        }
      },
    },
  });
}

/** The signed-in account, or null. The company name comes from the sign-up form. */
export async function currentAccount(): Promise<Account | null> {
  const client = await serverSupabase();
  const { data } = await client.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const company = user.user_metadata?.company;
  return {
    id: user.id,
    email: user.email ?? "",
    company: typeof company === "string" && company.trim() ? company.trim() : null,
  };
}
