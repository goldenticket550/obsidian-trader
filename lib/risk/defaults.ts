import type { RiskSettings } from "@/types/risk";

export const defaultRiskSettings: RiskSettings = {
  maxTradesPerDay: 3,
  maxLossPerDay: 400,
  dailyProfitTarget: 300,
  maxRiskPerTrade: 200,
  // Score is now normalized to a fixed 0-10 scale (see scorer.ts) - 6
  // roughly matches the same ~60-65% bar the old scale used.
  minSetupScore: 6,
  minMinutesBetweenTrades: 15,
  allowedSessions: ["regular"],
  blockAfterTarget: true,
  blockAfterLossLimit: true,
};
