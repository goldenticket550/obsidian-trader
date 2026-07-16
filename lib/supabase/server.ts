import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { required } from "@/lib/env";

/**
 * Server-side Supabase client — reads/writes the session via Next.js
 * cookies. Use this in Route Handlers, Server Components, and Server
 * Actions. Never import this into a "use client" component.
 *
 * Using the dynamic `required()` helper here is fine (unlike in
 * client.ts): this code runs in Node.js at request time, where
 * `process.env` is a real, fully-populated object — there's no build-time
 * bundle-inlining step to worry about like there is in the browser.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component that can't set cookies
            // directly (e.g. during static rendering). Safe to ignore
            // as long as middleware.ts is also refreshing the session,
            // which it is — see middleware.ts.
          }
        },
      },
    }
  );
}
