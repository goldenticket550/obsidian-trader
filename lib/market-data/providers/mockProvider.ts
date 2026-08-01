import type { CandleSeries } from "@/types/candle";
import type { GetCandlesParams, MarketDataProvider, SessionInfo } from "../types";
import { computeSessionInfo } from "../session";
import { mockScanInputs } from "@/lib/mock/scanInputs";

/**
 * Implements MarketDataProvider using the Phase 3 mock candle fixtures.
 * This is the default provider when no market-data API keys are
 * configured, so the app is always runnable out of the box — per the
 * spec's requirement to clearly identify simulated data rather than
 * silently fail or crash without a key.
 */
export class MockProvider implements MarketDataProvider {
  name = "mock";

  async getCandles(params: GetCandlesParams): Promise<CandleSeries> {
    const input = mockScanInputs.find((i) => i.symbol === params.symbol);
    if (!input) {
      return { symbol: params.symbol, timeframe: params.timeframe, quality: "simulated", candles: [] };
    }

    // 1m falls back to the 5m series rather than the daily one: without
    // an explicit branch an unrecognised timeframe silently returned
    // DAILY candles, so any 1m-backed test would have been quietly
    // asserting against the wrong series.
    const candles =
      params.timeframe === "1m" || params.timeframe === "5m"
        ? input.sessionCandles5m
        : params.timeframe === "15m"
        ? input.sessionCandles15m
        : input.dailyCandles;

    return {
      symbol: params.symbol,
      timeframe: params.timeframe,
      quality: "simulated",
      candles: params.limit ? candles.slice(-params.limit) : candles,
    };
  }

  async getSessionInfo(): Promise<SessionInfo> {
    return computeSessionInfo();
  }
}
