import type { RiskSettings, DailyTradingStatus } from "@/types/risk";
import type { AccountabilityChecks } from "@/types/watchlist";
import type { SessionInfo } from "@/lib/market-data/types";

export interface ComputeAccountabilityInput {
  settings: RiskSettings;
  status: DailyTradingStatus;
  session: SessionInfo;
  now: string; // ISO timestamp
  /** Score of the setup currently selected on the dashboard, if any. */
  selectedSetupScore?: number | null;
}

/**
 * Computes real accountability warnings from actual saved settings and
 * actual daily status — no more hardcoded mock booleans. Pure function,
 * no I/O, fully unit-testable.
 */
export function computeAccountabilityChecks(input: ComputeAccountabilityInput): AccountabilityChecks {
  const { settings, status, session, now, selectedSetupScore } = input;

  const tradesRemaining = Math.max(0, settings.maxTradesPerDay - status.tradesTaken);
  const dailyGoalReached = status.realizedPnl >= settings.dailyProfitTarget;
  const dailyLossLimitReached = status.realizedPnl <= -settings.maxLossPerDay;

  const attemptingLowScoringSetup =
    selectedSetupScore != null && selectedSetupScore < settings.minSetupScore;

  let tradingTooCloseTogether = false;
  if (status.lastTradeAt) {
    const minutesSinceLastTrade =
      (new Date(now).getTime() - new Date(status.lastTradeAt).getTime()) / 60_000;
    tradingTooCloseTogether = minutesSinceLastTrade < settings.minMinutesBetweenTrades;
  }

  const outsideAllowedSession = !settings.allowedSessions.includes(session.session);

  const blockedFromTrading =
    tradesRemaining <= 0 ||
    (settings.blockAfterTarget && dailyGoalReached) ||
    (settings.blockAfterLossLimit && dailyLossLimitReached);

  return {
    tradesRemaining,
    maxAllowedRisk: settings.maxRiskPerTrade,
    dailyGoalReached,
    dailyLossLimitReached,
    attemptingLowScoringSetup,
    tradingTooCloseTogether,
    outsideAllowedSession,
    blockedFromTrading,
  };
}
