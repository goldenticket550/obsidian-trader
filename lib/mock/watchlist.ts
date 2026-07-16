import type { WatchlistSymbol, AccountSummary, AccountabilityChecks } from "@/types/watchlist";

export const mockWatchlist: WatchlistSymbol[] = [
  {
    ticker: "NVDA",
    exchange: "NASDAQ",
    price: 134.82,
    dailyChangePct: -3.1,
    distanceFromSessionLowPct: 2.4,
    score5m: 8,
    score15m: 6,
    status5m: "green",
    status15m: "yellow",
    lastSignalTime: "2026-07-11T14:32:00Z",
  },
  {
    ticker: "TSLA",
    exchange: "NASDAQ",
    price: 261.15,
    dailyChangePct: -5.6,
    distanceFromSessionLowPct: 0.8,
    score5m: 4,
    score15m: 3,
    status5m: "yellow",
    status15m: "red",
    lastSignalTime: "2026-07-11T14:10:00Z",
  },
  {
    ticker: "AMD",
    exchange: "NASDAQ",
    price: 141.02,
    dailyChangePct: -1.2,
    distanceFromSessionLowPct: 3.9,
    score5m: 2,
    score15m: 2,
    status5m: "red",
    status15m: "red",
    lastSignalTime: null,
  },
  {
    ticker: "AAPL",
    exchange: "NASDAQ",
    price: 214.55,
    dailyChangePct: -0.4,
    distanceFromSessionLowPct: 5.1,
    score5m: 1,
    score15m: 1,
    status5m: "red",
    status15m: "red",
    lastSignalTime: null,
  },
];

export const mockAccountSummary: AccountSummary = {
  tradingDate: "2026-07-11",
  dailyTradeLimit: 3,
  tradesTakenToday: 1,
  dailyRealizedPnl: 145.5,
  dailyMaxLoss: -400,
  accountabilityStatus: "on_track",
};

export const mockAccountabilityChecks: AccountabilityChecks = {
  tradesRemaining: 2,
  maxAllowedRisk: 200,
  dailyGoalReached: false,
  dailyLossLimitReached: false,
  attemptingLowScoringSetup: false,
  tradingTooCloseTogether: false,
  outsideAllowedSession: false,
  blockedFromTrading: false,
};
