/**
 * Production-safe resolution of the app's public origin and post-auth
 * destination. This exists because the magic-link flow was sending the
 * OAuth code to `http://localhost:3000` in production: whenever Supabase
 * can't match `emailRedirectTo` against its allow-list it falls back to the
 * dashboard **Site URL**, and a leftover localhost Site URL then wins. The
 * code fix is to make `emailRedirectTo` deterministic (prefer an explicitly
 * configured HTTPS site URL) and to never construct a localhost redirect in
 * production; the Supabase dashboard must also be configured (see README).
 *
 * All functions here are pure — every input is passed in — so the behaviour
 * is unit-tested without a running server or real env.
 */

export interface OriginSources {
  /** NEXT_PUBLIC_SITE_URL — the canonical, explicitly configured public URL. */
  siteUrl?: string | null;
  /** The current request's own origin (server: new URL(req.url).origin;
   *  browser: window.location.origin). Trusted — not a forwarded header. */
  requestOrigin?: string | null;
  /** VERCEL_PROJECT_PRODUCTION_URL — stable production host (no scheme). */
  vercelProductionUrl?: string | null;
  /** VERCEL_URL — this specific deployment's host (no scheme). */
  vercelUrl?: string | null;
  /** NODE_ENV === "production". Governs the localhost / https rules. */
  isProduction?: boolean;
}

/** Parse a full URL or a bare host into a normalized http(s) origin, or null.
 *  Bare hosts (the Vercel vars) are assumed https — everything Vercel serves
 *  is https. */
function toOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

/**
 * Whether an origin may be used in the given environment. In production it
 * MUST be https and MUST NOT be localhost — that is the whole point: a
 * localhost origin can never win in production, no matter where it came
 * from. In development anything http(s) (including localhost) is fine.
 */
export function isAcceptableOrigin(
  origin: string | null,
  isProduction: boolean
): origin is string {
  if (!origin) return false;
  if (!isProduction) return true;
  if (isLocalhostOrigin(origin)) return false;
  return origin.startsWith("https://");
}

/**
 * Resolves the public origin to build auth redirect URLs from, in priority:
 *   1. NEXT_PUBLIC_SITE_URL (validated) — the canonical configured URL.
 *   2. The current trusted request origin.
 *   3. Vercel's production URL, then this deployment's URL (https).
 *   4. Localhost — ONLY in development.
 * In production, if nothing acceptable is found it throws rather than
 * silently emitting a localhost link.
 */
export function resolveSiteOrigin(sources: OriginSources): string {
  const isProduction = sources.isProduction ?? false;
  const candidates = [
    toOrigin(sources.siteUrl),
    toOrigin(sources.requestOrigin),
    toOrigin(sources.vercelProductionUrl),
    toOrigin(sources.vercelUrl),
  ];

  for (const candidate of candidates) {
    if (isAcceptableOrigin(candidate, isProduction)) return candidate;
  }

  if (!isProduction) return "http://localhost:3000";
  throw new Error(
    "Could not resolve a production site origin. Set NEXT_PUBLIC_SITE_URL to your deployed HTTPS URL."
  );
}

/**
 * Sanitizes a post-auth `next` destination. Only a same-origin RELATIVE
 * path is allowed; anything absolute, protocol-relative ("//evil.com"),
 * backslash-smuggled, or otherwise cross-origin collapses to "/". This is
 * what prevents the callback from becoming an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/"; // must be a relative path
  if (next.startsWith("//")) return "/"; // protocol-relative → external
  if (next.includes("\\")) return "/"; // backslash smuggling
  try {
    // Resolve against a dummy origin; anything that escapes it is external.
    const u = new URL(next, "http://localhost");
    if (u.origin !== "http://localhost") return "/";
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return "/";
  }
}

/**
 * Browser-side origin for building `emailRedirectTo`. Prefers the configured
 * NEXT_PUBLIC_SITE_URL (so the magic link always points at the canonical
 * URL that Supabase's allow-list is configured for), falling back to the
 * origin the user is actually on. Vercel server vars aren't available in the
 * browser, so window.location.origin is the production fallback there.
 */
export function browserAuthOrigin(siteUrl: string | undefined, windowOrigin: string): string {
  const isProduction = windowOrigin.startsWith("https://") && !isLocalhostOrigin(windowOrigin);
  return resolveSiteOrigin({
    siteUrl,
    requestOrigin: windowOrigin,
    isProduction,
  });
}
