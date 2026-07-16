import type { RiskSettings } from "@/types/risk";

export const defaultRiskSettings: RiskSettings = {
  maxTradesPerDay: 3,
  maxLossPerDay: 400,
  dailyProfitTarget: 300,
  maxRiskPerTrade: 200,
  minSetupScore: 7,
  minMinutesBetweenTrades: 15,
  allowedSessions: ["regular"],
  blockAfterTarget: true,
  blockAfterLossLimit: true,
};
