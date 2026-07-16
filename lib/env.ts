/**
 * Centralized environment-variable access. Phase 1 does not require any
 * secrets since it only renders mock data, but this module is in place
 * so later phases (Supabase, market-data providers) fail fast and loudly
 * instead of silently using `undefined` in the browser.
 *
 * Server-only variables must NOT be prefixed with NEXT_PUBLIC_.
 */

function optional(name: string): string | undefined {
  return process.env[name];
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Check your .env.local against .env.example.`
    );
  }
  return value;
}

export const env = {
  supabaseUrl: optional("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: optional("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  alpacaApiKeyId: optional("ALPACA_API_KEY_ID"),
  alpacaApiSecretKey: optional("ALPACA_API_SECRET_KEY"),
};

export { required };
