import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMarketDataProvider } from "@/lib/market-data/providerFactory";
import { scanWatchlistWithProvider } from "@/lib/scanner/scanService";
import { processResultPersistent } from "@/lib/alerts/persistentAlertStore";
import { defaultAlertRules } from "@/lib/alerts/defaultRules";
import { listAllWatchlists, getWatchlistSymbols, getStrategyConfig } from "@/lib/watchlist/queries";

// Allow up to Vercel's Pro-tier max; harmless on Hobby (just capped lower
// there). See README for the Hobby-plan cron-frequency limitation this
// route exists to work around.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Refuse to run at all if no secret is configured, rather than
  // silently allowing unauthenticated requests to trigger a scan of
  // every user's data.
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

interface UserScanResult {
  userId: string;
  symbolsScanned?: number;
  alertsFired?: number;
  error?: string;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const provider = getMarketDataProvider();
  const watchlists = await listAllWatchlists(supabase);

  const results: UserScanResult[] = [];

  for (const { id: watchlistId, userId } of watchlists) {
    try {
      const symbols = await getWatchlistSymbols(supabase, watchlistId);
      if (symbols.length === 0) {
        results.push({ userId, symbolsScanned: 0, alertsFired: 0 });
        continue;
      }

      const config = await getStrategyConfig(supabase, userId);
      const scan = await scanWatchlistWithProvider(symbols, provider, config);

      let alertsFired = 0;
      for (const symbolResults of Object.values(scan.resultsBySymbol)) {
        for (const setupResult of [symbolResults["5m"], symbolResults["15m"]]) {
          const fired = await processResultPersistent(
            supabase,
            userId,
            setupResult,
            defaultAlertRules
          );
          alertsFired += fired.length;
        }
      }

      results.push({ userId, symbolsScanned: symbols.length, alertsFired });
    } catch (error) {
      // One user's failure (e.g. a bad symbol, a rate-limited provider
      // call) shouldn't abort scanning everyone else.
      results.push({
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    provider: provider.name,
    usersScanned: results.length,
    results,
  });
}
