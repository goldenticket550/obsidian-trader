import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses Row Level Security entirely.
 *
 * ONLY use this for trusted, server-only batch operations that
 * legitimately need to act across multiple users at once (currently:
 * the cron scan route, iterating every user's watchlist). Never import
 * this into anything that handles a single user's request — use
 * lib/supabase/server.ts (RLS-protected, scoped to the requesting user)
 * for everything else.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY, which must never be prefixed with
 * NEXT_PUBLIC_ and must never reach the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "createAdminClient requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. " +
        "Get the service role key from Supabase Project Settings -> API -> service_role " +
        "(NOT the anon key) and add it to .env.local. Never expose this key to the browser."
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
