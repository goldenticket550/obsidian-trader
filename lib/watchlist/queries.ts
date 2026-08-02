import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import { normalizeAndValidateStrategyConfig } from "@/lib/strategies/reclaimContinuationConfig";
import type { WatchedSymbol } from "@/lib/scanner/scanService";

/**
 * Fetches the user's default watchlist, creating one with no symbols if
 * they don't have one yet. This means there's no separate "onboarding"
 * step required — signing in for the first time is enough to get a
 * usable (if empty) watchlist.
 */
export async function getOrCreateDefaultWatchlist(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const { data: existing, error: fetchError } = await supabase
    .from("watchlists")
    .select("id")
    .eq("user_id", userId)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();

  if (fetchError) throw new Error(`Failed to fetch watchlist: ${fetchError.message}`);
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from("watchlists")
    .insert({ user_id: userId, name: "My Watchlist", is_default: true })
    .select("id")
    .single();

  if (insertError) throw new Error(`Failed to create watchlist: ${insertError.message}`);
  return created.id;
}

export async function getWatchlistSymbols(
  supabase: SupabaseClient,
  watchlistId: string
): Promise<WatchedSymbol[]> {
  const { data, error } = await supabase
    .from("watchlist_symbols")
    .select("symbol, exchange")
    .eq("watchlist_id", watchlistId)
    .order("added_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch watchlist symbols: ${error.message}`);
  return (data ?? []).map((row) => ({ symbol: row.symbol, exchange: row.exchange }));
}

export async function addWatchlistSymbol(
  supabase: SupabaseClient,
  watchlistId: string,
  symbol: string,
  exchange: string
): Promise<void> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) throw new Error("Symbol cannot be empty");

  const { error } = await supabase
    .from("watchlist_symbols")
    .insert({ watchlist_id: watchlistId, symbol: normalizedSymbol, exchange });

  // Unique constraint violation (symbol already on the watchlist) is not
  // a real error from the user's perspective — treat it as a no-op.
  if (error && error.code !== "23505") {
    throw new Error(`Failed to add symbol: ${error.message}`);
  }
}

export async function removeWatchlistSymbol(
  supabase: SupabaseClient,
  watchlistId: string,
  symbol: string
): Promise<void> {
  const { error } = await supabase
    .from("watchlist_symbols")
    .delete()
    .eq("watchlist_id", watchlistId)
    .eq("symbol", symbol.trim().toUpperCase());

  if (error) throw new Error(`Failed to remove symbol: ${error.message}`);
}

/**
 * Returns the user's saved strategy config, or the built-in defaults if
 * they haven't customized anything yet. Never throws just because no row
 * exists — that's the normal, expected state for a new user.
 */
export async function getStrategyConfig(
  supabase: SupabaseClient,
  userId: string
): Promise<StrategyConfig> {
  const { data, error } = await supabase
    .from("strategy_configs")
    .select("config")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch strategy config: ${error.message}`);
  if (!data) return defaultStrategyConfig;

  // Shallow-merge over defaults so a config saved before a new threshold
  // was added to StrategyConfig doesn't end up missing fields the scorer
  // expects.
  const merged = { ...defaultStrategyConfig, ...(data.config as Partial<StrategyConfig>) };

  // ...then normalize the NESTED blocks the shallow merge cannot reach: a
  // partially stored reclaimContinuation object would otherwise replace
  // the whole default block and arrive missing keys. Read-only — stored
  // configuration is never rewritten just by being read.
  const { config, errors } = normalizeAndValidateStrategyConfig(merged);

  // A legacy config missing keys normalizes cleanly above. A config with a
  // value that is PRESENT and invalid fails here, at the configuration
  // boundary, rather than reaching the detector and producing plausible
  // wrong stages from a threshold nobody chose.
  if (errors.length > 0) {
    throw new Error(
      `Stored strategy configuration is invalid: ${errors
        .map((e) => `${e.field} ${e.message}`)
        .join("; ")}`
    );
  }

  return config;
}

export async function upsertStrategyConfig(
  supabase: SupabaseClient,
  userId: string,
  config: StrategyConfig
): Promise<void> {
  const { error } = await supabase
    .from("strategy_configs")
    .upsert({ user_id: userId, config }, { onConflict: "user_id" });

  if (error) throw new Error(`Failed to save strategy config: ${error.message}`);
}

export interface WatchlistRef {
  id: string;
  userId: string;
}

/**
 * Lists every watchlist in the system. Only meaningful when called with
 * an admin (service-role) client — RLS would otherwise silently scope
 * this to a single user's own watchlist. Used exclusively by the cron
 * scan route to iterate every user's watchlist in one batch job.
 */
export async function listAllWatchlists(supabase: SupabaseClient): Promise<WatchlistRef[]> {
  const { data, error } = await supabase.from("watchlists").select("id, user_id");
  if (error) throw new Error(`Failed to list watchlists: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id as string, userId: row.user_id as string }));
}
