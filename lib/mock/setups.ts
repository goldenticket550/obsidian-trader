import type { SetupResult } from "@/types/setup";

/**
 * Mock setup checklist for NVDA on the 5m timeframe, mirroring what the
 * Phase 2 rule engine will eventually produce from real candle data.
 * Every field here is a stand-in for a calculated value, not a guess.
 */
export const mockSetupResults: Record<string, SetupResult> = {
  NVDA: {
    symbol: "NVDA",
    timeframe: "5m",
    quality: "simulated",
    stage: "ema_reclaim",
    status: "yellow",
    score: 6,
    maxScore: 10,
    lastUpdated: "2026-07-11T14:32:00Z",
    convictionLevel: "developing",
    entryStatus: "wait_for_pullback",
    invalidationNote: { level: 115, reason: "structure_failed" },
    conditions: [
      {
        id: "intraday_decline",
        label: "Significant intraday decline",
        state: "pass",
        detail: "-3.1% from session open",
        required: true,
      },
      {
        id: "recovery_from_low",
        label: "Recovery from session low",
        state: "pass",
        detail: "$2.15 recovered from $132.67 low",
        required: true,
      },
      {
        id: "consecutive_bullish",
        label: "Consecutive bullish candles",
        state: "pass",
        detail: "3 consecutive closes higher",
        required: true,
      },
      {
        id: "liquidity_sweep",
        label: "Liquidity sweep",
        state: "pass",
        detail: "Swept pivot low at $132.80, closed back above",
        required: true,
      },
      {
        id: "structure_shift",
        label: "Bullish market-structure shift",
        state: "waiting",
        detail: "Needs close above swing high $135.10",
        required: true,
      },
      {
        id: "ema_reclaim",
        label: "9 EMA reclaim",
        state: "pass",
        detail: "Price $134.82 vs EMA $134.10 (+0.5%)",
        required: true,
      },
      {
        id: "fair_value_gap",
        label: "Valid bullish fair value gap",
        state: "waiting",
        detail: "No qualifying 3-candle gap yet",
        required: true,
      },
      {
        id: "gap_proximity",
        label: "Price approaching selected gap",
        state: "waiting",
        detail: "No gap selected",
        required: false,
      },
      {
        id: "volume_confirmation",
        label: "Volume confirmation",
        state: "pass",
        detail: "142% of 20-period average volume",
        required: false,
      },
      {
        id: "risk_conditions",
        label: "Risk conditions acceptable",
        state: "pass",
        detail: "Within daily trade limit and max risk",
        required: true,
      },
    ],
  },
};
