import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes that don't require session-cookie authentication. /api/cron/*
// routes are intentionally here too — they're never called with a user's
// session cookie (Vercel Cron or an external scheduler calls them
// directly), and each one enforces its own independent secret-based auth
// (see app/api/cron/scan/route.ts's isAuthorized() check). Without this
// exclusion, middleware would redirect every cron request to /login
// before the route's own auth check ever ran, making the endpoint
// permanently unreachable by its actual caller.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/api/cron"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase isn't configured at all, don't block the app — this
  // keeps Phases 1-5 runnable exactly as before for anyone who hasn't
  // set up Supabase yet. Once it IS configured, auth is enforced below.
  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and Next internals, so the
     * session gets refreshed on every real navigation and API call.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
