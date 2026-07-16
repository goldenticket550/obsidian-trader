import type { SessionType } from "@/lib/market-data/types";

export interface RiskSettings {
  maxTradesPerDay: number;
  maxLossPerDay: number; // stored as a positive number, e.g. 400 means "-$400"
  dailyProfitTarget: number;
  maxRiskPerTrade: number;
  minSetupScore: number;
  minMinutesBetweenTrades: number;
  allowedSessions: SessionType[];
  blockAfterTarget: boolean;
  blockAfterLossLimit: boolean;
}

export interface DailyTradingStatus {
  tradeDate: string; // YYYY-MM-DD, US Eastern trading day
  tradesTaken: number;
  realizedPnl: number;
  lastTradeAt: string | null; // ISO timestamp
}
