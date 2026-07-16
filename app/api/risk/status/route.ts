import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRiskSettings, getOrCreateTodayStatus } from "@/lib/risk/queries";
import { computeAccountabilityChecks } from "@/lib/risk/accountabilityEngine";
import { computeSessionInfo } from "@/lib/market-data/session";
import { defaultRiskSettings } from "@/lib/risk/defaults";
import { mockAccountSummary } from "@/lib/mock/watchlist";

// Note: this route is now read-only (GET only). It used to also expose a
// POST for a lightweight "Log Trade" widget that manually incremented
// daily_trading_status. That's been removed now that the trade journal
// exists — journal entries are the single source of truth for daily
// status via recomputeDailyStatusFromJournal() (see lib/journal/queries.ts),
// so leaving a second, independent write path here would let the two
// silently drift out of sync with each other.

function supabaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const selectedScoreParam = searchParams.get("selectedScore");
  const selectedSetupScore = selectedScoreParam ? Number(selectedScoreParam) : null;

  // Mirrors /api/scan's fallback: keeps the dashboard fully runnable
  // without Supabase configured, same mock values Phases 1-5 always used.
  if (!supabaseConfigured()) {
    const session = computeSessionInfo();
    const status = {
      tradeDate: mockAccountSummary.tradingDate,
      tradesTaken: mockAccountSummary.tradesTakenToday,
      realizedPnl: mockAccountSummary.dailyRealizedPnl,
      lastTradeAt: null,
    };
    const checks = computeAccountabilityChecks({
      settings: defaultRiskSettings,
      status,
      session,
      now: new Date().toISOString(),
      selectedSetupScore,
    });
    return NextResponse.json({
      settings: defaultRiskSettings,
      status,
      session,
      checks,
      usingFallback: true,
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const settings = await getRiskSettings(supabase, user.id);
    const status = await getOrCreateTodayStatus(supabase, user.id);
    const session = computeSessionInfo();
    const now = new Date().toISOString();

    const checks = computeAccountabilityChecks({
      settings,
      status,
      session,
      now,
      selectedSetupScore,
    });

    return NextResponse.json({ settings, status, session, checks, usingFallback: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
