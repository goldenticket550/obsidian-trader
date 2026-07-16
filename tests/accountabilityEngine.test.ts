import { describe, it, expect } from "vitest";
import { computeAccountabilityChecks } from "@/lib/risk/accountabilityEngine";
import { defaultRiskSettings } from "@/lib/risk/defaults";
import type { DailyTradingStatus } from "@/types/risk";
import type { SessionInfo } from "@/lib/market-data/types";

const baseStatus: DailyTradingStatus = {
  tradeDate: "2026-07-13",
  tradesTaken: 0,
  realizedPnl: 0,
  lastTradeAt: null,
};

const regularSession: SessionInfo = { isOpen: true, session: "regular", nextOpenTime: null };
const NOW = "2026-07-13T15:00:00Z";

describe("computeAccountabilityChecks", () => {
  it("reports full trades remaining and no warnings on a clean slate", () => {
    const checks = computeAccountabilityChecks({
      settings: defaultRiskSettings,
      status: baseStatus,
      session: regularSession,
      now: NOW,
    });
    expect(checks.tradesRemaining).toBe(defaultRiskSettings.maxTradesPerDay);
    expect(checks.dailyGoalReached).toBe(false);
    expect(checks.dailyLossLimitReached).toBe(false);
    expect(checks.blockedFromTrading).toBe(false);
  });

  it("clamps tradesRemaining at zero, never negative", () => {
    const checks = computeAccountabilityChecks({
      settings: defaultRiskSettings,
      status: { ...baseStatus, tradesTaken: defaultRiskSettings.maxTradesPerDay + 5 },
      session: regularSession,
      now: NOW,
    });
    expect(checks.tradesRemaining).toBe(0);
    expect(checks.blockedFromTrading).toBe(true);
  });

  it("flags dailyGoalReached and blocks trading when configured to", () => {
    const checks = computeAccountabilityChecks({
      settings: { ...defaultRiskSettings, blockAfterTarget: true },
      status: { ...baseStatus, realizedPnl: defaultRiskSettings.dailyProfitTarget },
      session: regularSession,
      now: NOW,
    });
    expect(checks.dailyGoalReached).toBe(true);
    expect(checks.blockedFromTrading).toBe(true);
  });

  it("does not block on goal reached when blockAfterTarget is false", () => {
    const checks = computeAccountabilityChecks({
      settings: { ...defaultRiskSettings, blockAfterTarget: false },
      status: { ...baseStatus, realizedPnl: defaultRiskSettings.dailyProfitTarget },
      session: regularSession,
      now: NOW,
    });
    expect(checks.dailyGoalReached).toBe(true);
    expect(checks.blockedFromTrading).toBe(false);
  });

  it("flags dailyLossLimitReached when realized P&L is at or below the negative threshold", () => {
    const checks = computeAccountabilityChecks({
      settings: defaultRiskSettings,
      status: { ...baseStatus, realizedPnl: -defaultRiskSettings.maxLossPerDay },
      session: regularSession,
      now: NOW,
    });
    expect(checks.dailyLossLimitReached).toBe(true);
  });

  it("flags attemptingLowScoringSetup only when a score is provided and below threshold", () => {
    const belowThreshold = computeAccountabilityChecks({
      settings: defaultRiskSettings,
      status: baseStatus,
      session: regularSession,
      now: NOW,
      selectedSetupScore: defaultRiskSettings.minSetupScore - 1,
    });
    expect(belowThreshold.attemptingLowScoringSetup).toBe(true);

    const noneSelected = computeAccountabilityChecks({
      settings: defaultRiskSettings,
      status: baseStatus,
      session: regularSession,
      now: NOW,
      selectedSetupScore: null,
    });
    expect(noneSelected.attemptingLowScoringSetup).toBe(false);
  });

  it("flags tradingTooCloseTogether when the last trade was recent", () => {
    const checks = computeAccountabilityChecks({
      settings: defaultRiskSettings,
      status: { ...baseStatus, lastTradeAt: "2026-07-13T14:58:00Z" }, // 2 min before NOW
      session: regularSession,
      now: NOW,
    });
    expect(checks.tradingTooCloseTogether).toBe(true);
  });

  it("does not flag tradingTooCloseTogether once enough time has passed", () => {
    const checks = computeAccountabilityChecks({
      settings: defaultRiskSettings,
      status: { ...baseStatus, lastTradeAt: "2026-07-13T14:00:00Z" }, // 60 min before NOW
      session: regularSession,
      now: NOW,
    });
    expect(checks.tradingTooCloseTogether).toBe(false);
  });

  it("flags outsideAllowedSession when the current session isn't in the allowed list", () => {
    const checks = computeAccountabilityChecks({
      settings: { ...defaultRiskSettings, allowedSessions: ["regular"] },
      status: baseStatus,
      session: { isOpen: false, session: "pre-market", nextOpenTime: null },
      now: NOW,
    });
    expect(checks.outsideAllowedSession).toBe(true);
  });

  it("does not flag outsideAllowedSession when the session is allowed", () => {
    const checks = computeAccountabilityChecks({
      settings: { ...defaultRiskSettings, allowedSessions: ["regular", "pre-market"] },
      status: baseStatus,
      session: { isOpen: false, session: "pre-market", nextOpenTime: null },
      now: NOW,
    });
    expect(checks.outsideAllowedSession).toBe(false);
  });
});
