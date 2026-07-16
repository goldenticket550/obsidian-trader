import { createBrowserClient } from "@supabase/ssr";

/**
 * Client-component Supabase client. Uses the public anon key only —
 * RLS policies (see supabase/migrations) are what actually protect data,
 * not this key being secret.
 *
 * IMPORTANT: these must be static `process.env.NEXT_PUBLIC_X` literals,
 * NOT routed through the generic `required()` helper in lib/env.ts.
 * Next.js only inlines NEXT_PUBLIC_ values into the browser bundle when
 * it can statically find that exact literal token in source at build
 * time — a dynamic `process.env[name]` lookup (which `required()` uses)
 * can't be analyzed that way, so it silently resolves to `undefined` in
 * the actual browser even when the variable is correctly set in
 * `.env.local`. This bit us once already (see README) — don't
 * reintroduce it by "cleaning up" this duplication later.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Check your .env.local against .env.example, and restart the dev server " +
        "after editing it (Next.js only reads .env.local on startup)."
    );
  }

  return createBrowserClient(url, anonKey);
}
