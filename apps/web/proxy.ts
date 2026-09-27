import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Gates the console and refreshes the session cookie.
 *
 * Only `/console/**` and `/signin` run through here (see `config` below): the landing page and
 * every `/api/*` route stay public, because the widget on a customer's site and the worker call
 * them without a browser session.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getUser revalidates the token with Supabase, which getSession does not do.
  const { data } = await supabase.auth.getUser();
  const signedIn = Boolean(data.user);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && pathname.startsWith("/console")) {
    const target = request.nextUrl.clone();
    target.pathname = "/signin";
    target.search = "";
    target.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(target);
  }

  if (signedIn && pathname === "/signin") {
    const target = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    target.pathname = next?.startsWith("/console") ? next.split("?")[0] ?? "/console" : "/console";
    target.search = "";
    return NextResponse.redirect(target);
  }

  return response;
}

export const config = {
  matcher: ["/console/:path*", "/signin"],
};
