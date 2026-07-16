import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMarketDataProvider } from "@/lib/market-data/providerFactory";
import { scanWatchlistWithProvider } from "@/lib/scanner/scanService";
import { getStrategyConfig } from "@/lib/watchlist/queries";
import { callClaude, isAiConfigured } from "@/lib/ai/client";
import { buildExplainSetupPrompt } from "@/lib/ai/prompts";
import type { Timeframe } from "@/types/candle";

type IntradayTimeframe = Extract<Timeframe, "5m" | "15m">;

function isIntradayTimeframe(value: unknown): value is IntradayTimeframe {
  return value === "5m" || value === "15m";
}

export async function POST(request: Request) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI explanations require ANTHROPIC_API_KEY to be configured." },
      { status: 501 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
    const timeframe: IntradayTimeframe = isIntradayTimeframe(body.timeframe) ? body.timeframe : "5m";
    const exchange = typeof body.exchange === "string" ? body.exchange : "NASDAQ";

    if (!symbol) {
      return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    // Re-scan just this one symbol rather than trusting a client-supplied
    // SetupResult — the explanation must be grounded in freshly computed,
    // server-verified data, never in whatever the browser claims is true.
    const provider = getMarketDataProvider();
    const config = await getStrategyConfig(supabase, user.id);
    const scan = await scanWatchlistWithProvider([{ symbol, exchange }], provider, config);
    const result = scan.resultsBySymbol[symbol]?.[timeframe];

    if (!result) {
      return NextResponse.json({ error: "Could not compute a result for that symbol" }, { status: 404 });
    }

    const { system, user: userPrompt } = buildExplainSetupPrompt(result);
    const explanation = await callClaude(system, userPrompt, 400);

    return NextResponse.json({ explanation, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
