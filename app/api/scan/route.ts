import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMarketDataProvider } from "@/lib/market-data/providerFactory";
import { scanWatchlistWithProvider, type WatchedSymbol } from "@/lib/scanner/scanService";
import { getAlertStore } from "@/lib/alerts/alertStore";
import { processResultPersistent } from "@/lib/alerts/persistentAlertStore";
import { defaultAlertRules } from "@/lib/alerts/defaultRules";
import type { AlertEvent } from "@/lib/alerts/types";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWatchlist, getWatchlistSymbols, getStrategyConfig } from "@/lib/watchlist/queries";

// Fallback watchlist used only when Supabase isn't configured at all —
// keeps Phases 1-5 runnable exactly as before for anyone who hasn't set
// up Supabase yet. Once Supabase IS configured, the real per-user
// watchlist below takes over and this is never used.
const FALLBACK_SYMBOLS: WatchedSymbol[] = [
  { symbol: "NVDA", exchange: "NASDAQ" },
  { symbol: "TSLA", exchange: "NASDAQ" },
  { symbol: "AMD", exchange: "NASDAQ" },
  { symbol: "AAPL", exchange: "NASDAQ" },
];

async function resolveWatchlistAndConfig(): Promise<{
  symbols: WatchedSymbol[];
  config: StrategyConfig;
  usingFallback: boolean;
  supabase: SupabaseClient | null;
  userId: string | null;
}> {
  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseConfigured) {
    return {
      symbols: FALLBACK_SYMBOLS,
      config: defaultStrategyConfig,
      usingFallback: true,
      supabase: null,
      userId: null,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirects unauthenticated page loads to /login,
  // but a direct hit on this route without a valid session should still
  // fail safely rather than silently scanning the fallback list.
  if (!user) {
    throw new Error("Not authenticated");
  }

  const watchlistId = await getOrCreateDefaultWatchlist(supabase, user.id);
  const symbols = await getWatchlistSymbols(supabase, watchlistId);
  const config = await getStrategyConfig(supabase, user.id);

  return { symbols, config, usingFallback: false, supabase, userId: user.id };
}

export async function GET() {
  try {
    const { symbols, config, usingFallback, supabase, userId } = await resolveWatchlistAndConfig();
    const provider = getMarketDataProvider();
    const result = await scanWatchlistWithProvider(symbols, provider, config);
    const newEvents: AlertEvent[] = [];

    if (supabase && userId) {
      // Real user: persistent alert store, survives restarts and
      // stateless serverless invocations (e.g. a future cron run).
      for (const symbolResults of Object.values(result.resultsBySymbol)) {
        for (const setupResult of [symbolResults["5m"], symbolResults["15m"]]) {
          const fired = await processResultPersistent(supabase, userId, setupResult, defaultAlertRules);
          newEvents.push(...fired);
        }
      }
    } else {
      // No-Supabase fallback: same in-memory store Phase 5 always used.
      const store = getAlertStore();
      const now = new Date().toISOString();
      for (const symbolResults of Object.values(result.resultsBySymbol)) {
        for (const setupResult of [symbolResults["5m"], symbolResults["15m"]]) {
          newEvents.push(...store.processResult(setupResult, defaultAlertRules, now));
        }
      }
    }

    return NextResponse.json({
      provider: provider.name,
      usingFallbackWatchlist: usingFallback,
      ...result,
      newAlerts: newEvents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scan error";
    console.error("[/api/scan] scan failed:", message);
    const status = message === "Not authenticated" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
