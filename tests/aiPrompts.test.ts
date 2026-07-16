import { describe, it, expect } from "vitest";
import {
  buildExplainSetupPrompt,
  buildEndOfDaySummaryPrompt,
  buildPatternAnalysisPrompt,
  buildAccountabilityReminderPrompt,
  hasEnoughDataForPatternAnalysis,
} from "@/lib/ai/prompts";
import type { SetupResult } from "@/types/setup";
import type { JournalEntry } from "@/types/journal";
import type { JournalStatistics } from "@/lib/journal/statistics";
import type { AccountabilityChecks } from "@/types/watchlist";
import { defaultRiskSettings } from "@/lib/risk/defaults";

const sampleResult: SetupResult = {
  symbol: "NVDA",
  timeframe: "5m",
  quality: "realtime",
  stage: "ema_reclaim",
  status: "yellow",
  score: 6,
  maxScore: 11,
  conditions: [
    { id: "recovery_from_low", label: "Recovery from session low", state: "pass", detail: "$2.15 recovered", required: true },
    { id: "structure_shift", label: "Market-structure shift", state: "waiting", required: true },
  ],
  lastUpdated: "2026-07-13T14:00:00Z",
};

describe("buildExplainSetupPrompt", () => {
  it("includes every safety guardrail from the spec", () => {
    const { system } = buildExplainSetupPrompt(sampleResult);
    expect(system).toMatch(/never.*predict.*price/i);
    expect(system).toMatch(/never.*recommend/i);
    expect(system).toMatch(/not an automated trading bot/i);
    expect(system).toMatch(/only reference the exact values/i);
  });

  it("includes the actual result data in the user prompt", () => {
    const { user } = buildExplainSetupPrompt(sampleResult);
    expect(user).toContain("NVDA");
    expect(user).toContain("6/11");
    expect(user).toContain("Recovery from session low");
    expect(user).toContain("$2.15 recovered");
  });

  it("does not fabricate data for a result with no conditions evaluated", () => {
    const empty: SetupResult = { ...sampleResult, conditions: [] };
    const { user } = buildExplainSetupPrompt(empty);
    expect(user).toContain("(none evaluated)");
  });
});

describe("buildEndOfDaySummaryPrompt", () => {
  const entry: JournalEntry = {
    id: "1",
    tradeDate: "2026-07-13",
    symbol: "NVDA",
    direction: "long",
    entryPrice: 100,
    exitPrice: 105,
    positionSize: 10,
    stopLoss: 98,
    profitLoss: 50,
    setupScoreAtEntry: 8,
    conditionsPassed: [],
    conditionsMissing: [],
    screenshotUrl: null,
    notes: null,
    emotionalState: "Calm",
    followedPlan: true,
    mistakeCategory: null,
    lessonLearned: "Waited for confirmation, worked out well.",
    tags: [],
    createdAt: "2026-07-13T14:00:00Z",
  };
  const stats: JournalStatistics = {
    totalTrades: 1,
    winCount: 1,
    lossCount: 0,
    breakEvenCount: 0,
    winRate: 1,
    totalPnl: 50,
    averagePnl: 50,
    planFollowingRate: 1,
    mistakeCounts: {},
  };

  it("includes actual entry data, not fabricated details", () => {
    const { user } = buildEndOfDaySummaryPrompt([entry], stats, "2026-07-13");
    expect(user).toContain("NVDA");
    expect(user).toContain("Waited for confirmation");
    expect(user).toContain("50");
  });

  it("instructs the model not to infer beyond what was written", () => {
    const { system } = buildEndOfDaySummaryPrompt([entry], stats, "2026-07-13");
    expect(system).toMatch(/do not infer/i);
  });
});

describe("hasEnoughDataForPatternAnalysis", () => {
  it("returns false below the threshold", () => {
    expect(hasEnoughDataForPatternAnalysis(5)).toBe(false);
  });

  it("returns true at or above the threshold", () => {
    expect(hasEnoughDataForPatternAnalysis(10)).toBe(true);
    expect(hasEnoughDataForPatternAnalysis(15)).toBe(true);
  });
});

describe("buildPatternAnalysisPrompt", () => {
  it("instructs the model to stay within the provided data", () => {
    const stats: JournalStatistics = {
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      breakEvenCount: 0,
      winRate: 0,
      totalPnl: 0,
      averagePnl: 0,
      planFollowingRate: 0,
      mistakeCounts: {},
    };
    const { system } = buildPatternAnalysisPrompt([], stats);
    expect(system).toMatch(/do not speculate beyond it/i);
  });
});

describe("buildAccountabilityReminderPrompt", () => {
  const checksBlocked: AccountabilityChecks = {
    tradesRemaining: 0,
    maxAllowedRisk: 200,
    dailyGoalReached: false,
    dailyLossLimitReached: true,
    attemptingLowScoringSetup: false,
    tradingTooCloseTogether: false,
    outsideAllowedSession: false,
    blockedFromTrading: true,
  };
  const checksClean: AccountabilityChecks = {
    tradesRemaining: 3,
    maxAllowedRisk: 200,
    dailyGoalReached: false,
    dailyLossLimitReached: false,
    attemptingLowScoringSetup: false,
    tradingTooCloseTogether: false,
    outsideAllowedSession: false,
    blockedFromTrading: false,
  };

  it("surfaces active warnings in the prompt", () => {
    const { user } = buildAccountabilityReminderPrompt(checksBlocked, defaultRiskSettings);
    expect(user).toContain("Daily loss limit has been reached");
    expect(user).toContain("Trading is currently blocked");
  });

  it("says nothing is active when everything is clean, rather than inventing a warning", () => {
    const { user } = buildAccountabilityReminderPrompt(checksClean, defaultRiskSettings);
    expect(user).toContain("None — everything looks normal");
  });

  it("clarifies the AI is not the one deciding whether trading is blocked", () => {
    const { system } = buildAccountabilityReminderPrompt(checksBlocked, defaultRiskSettings);
    expect(system).toMatch(/not deciding whether the user should be blocked/i);
  });
});
