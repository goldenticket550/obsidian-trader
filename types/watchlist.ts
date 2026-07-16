export interface WatchlistSymbol {
  ticker: string;
  exchange: string; // e.g. "NASDAQ", used to build TradingView links
  price: number;
  dailyChangePct: number;
  distanceFromSessionLowPct: number;
  score5m: number;
  score15m: number;
  status5m: "red" | "yellow" | "green";
  status15m: "red" | "yellow" | "green";
  lastSignalTime: string | null; // ISO timestamp
}

export interface AccountSummary {
  tradingDate: string;
  dailyTradeLimit: number;
  tradesTakenToday: number;
  dailyRealizedPnl: number;
  dailyMaxLoss: number;
  accountabilityStatus: "on_track" | "at_limit" | "over_limit" | "target_hit";
}

export interface AccountabilityChecks {
  tradesRemaining: number;
  maxAllowedRisk: number;
  dailyGoalReached: boolean;
  dailyLossLimitReached: boolean;
  attemptingLowScoringSetup: boolean;
  tradingTooCloseTogether: boolean;
  outsideAllowedSession: boolean;
  blockedFromTrading: boolean;
}
