import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAcceptableOrigin, resolveSiteOrigin, safeNextPath } from "@/lib/auth/origin";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only a validated same-origin relative path is honoured — never an
  // attacker-supplied absolute/external URL (open-redirect guard).
  const next = safeNextPath(searchParams.get("redirectTo"));

  const isProduction = process.env.NODE_ENV === "production";

  // Redirect back to where the user actually is (supports preview
  // deployments), but never emit a localhost/non-https base in production —
  // fall back to the configured canonical origin if the request origin is
  // somehow unacceptable.
  const base = isAcceptableOrigin(origin, isProduction)
    ? origin
    : resolveSiteOrigin({
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
        requestOrigin: origin,
        vercelProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
        vercelUrl: process.env.VERCEL_URL,
        isProduction,
      });

  if (code) {
    const supabase = await createClient();
    // Exchange happens only here, in the intended callback. The code is
    // never logged. PKCE verifier handling is internal to @supabase/ssr.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  // Something went wrong with the code exchange — send them back to
  // login rather than into a broken authenticated state. No error detail
  // that could contain sensitive material is placed in the URL.
  return NextResponse.redirect(`${base}/login?error=auth_callback_failed`);
}
