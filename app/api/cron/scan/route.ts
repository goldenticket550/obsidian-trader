import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMarketDataProvider } from "@/lib/market-data/providerFactory";
import { scanWatchlistWithProvider } from "@/lib/scanner/scanService";
import {
  processResultPersistent,
  recordCandidatesPersistent,
} from "@/lib/alerts/persistentAlertStore";
import { buildReclaimAlertCandidates } from "@/lib/alerts/reclaimAlerts";
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
  symbolsAttempted?: number;
  symbolsSucceeded?: number;
  symbolsFailed?: number;
  alertsFired?: number;
  symbolErrors?: { symbol: string; message: string }[];
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

  // FIX (Codex round 5): a single symbol's retry delays (even capped at
  // MAX_RETRY_DELAY_MS each) could still add up across a sequential
  // multi-symbol, multi-user scan and eat meaningfully into this route's
  // maxDuration=60 budget, potentially starving every later symbol/user.
  // Computing a real deadline here — with a safety buffer below the
  // actual route limit — and threading it through to every provider call
  // means a slow/failing symbol fails fast instead of risking that.
  const routeStartedAt = Date.now();
  const deadlineAt = routeStartedAt + (maxDuration - 10) * 1000; // 10s safety buffer

  const provider = getMarketDataProvider();
  const watchlists = await listAllWatchlists(supabase);

  const results: UserScanResult[] = [];

  for (const { id: watchlistId, userId } of watchlists) {
    try {
      const symbols = await getWatchlistSymbols(supabase, watchlistId);
      if (symbols.length === 0) {
        results.push({ userId, symbolsAttempted: 0, symbolsSucceeded: 0, symbolsFailed: 0, alertsFired: 0 });
        continue;
      }

      const config = await getStrategyConfig(supabase, userId);
      const scan = await scanWatchlistWithProvider(
        symbols,
        provider,
        config,
        new Date().toISOString(),
        deadlineAt
      );

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

      // Reclaim alerts, additive and isolated exactly as in /api/scan:
      // reversal alerts above are already recorded and are unaffected by
      // anything that happens here.
      try {
        const { events, rules } = buildReclaimAlertCandidates(
          scan.reclaimBySymbol,
          config.reclaimContinuation,
          new Date().toISOString()
        );
        if (events.length > 0) {
          const fired = await recordCandidatesPersistent(supabase, userId, events, rules);
          alertsFired += fired.length;
        }
      } catch (error) {
        console.error("[cron/scan] reclaim alert emission failed:", error);
      }

      // FIX (Codex round 4): this used to report symbols.length (every
      // symbol ATTEMPTED) as "symbolsScanned," which silently counted
      // failed symbols as if they'd succeeded. Now reports attempted,
      // succeeded, and failed as distinct, honest numbers.
      results.push({
        userId,
        symbolsAttempted: symbols.length,
        symbolsSucceeded: scan.watchlist.length,
        symbolsFailed: scan.errors.length,
        alertsFired,
        symbolErrors: scan.errors.length > 0 ? scan.errors : undefined,
      });
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
