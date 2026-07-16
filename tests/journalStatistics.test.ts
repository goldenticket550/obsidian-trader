import { describe, it, expect } from "vitest";
import { computeJournalStatistics } from "@/lib/journal/statistics";
import type { JournalEntry } from "@/types/journal";

function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "1",
    tradeDate: "2026-07-13",
    symbol: "NVDA",
    direction: "long",
    entryPrice: 100,
    exitPrice: 101,
    positionSize: 10,
    stopLoss: 99,
    profitLoss: 10,
    setupScoreAtEntry: 8,
    conditionsPassed: [],
    conditionsMissing: [],
    screenshotUrl: null,
    notes: null,
    emotionalState: null,
    followedPlan: true,
    mistakeCategory: null,
    lessonLearned: null,
    tags: [],
    createdAt: "2026-07-13T14:00:00Z",
    ...overrides,
  };
}

describe("computeJournalStatistics", () => {
  it("returns all zeros for an empty entry list", () => {
    const stats = computeJournalStatistics([]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.totalPnl).toBe(0);
    expect(stats.planFollowingRate).toBe(0);
  });

  it("computes win rate correctly across wins and losses", () => {
    const entries = [
      makeEntry({ profitLoss: 100 }),
      makeEntry({ profitLoss: -50 }),
      makeEntry({ profitLoss: 30 }),
    ];
    const stats = computeJournalStatistics(entries);
    expect(stats.winCount).toBe(2);
    expect(stats.lossCount).toBe(1);
    expect(stats.winRate).toBeCloseTo(2 / 3, 5);
  });

  it("excludes break-even trades from the win-rate denominator", () => {
    const entries = [
      makeEntry({ profitLoss: 100 }),
      makeEntry({ profitLoss: 0 }),
      makeEntry({ profitLoss: -50 }),
    ];
    const stats = computeJournalStatistics(entries);
    expect(stats.breakEvenCount).toBe(1);
    expect(stats.winRate).toBeCloseTo(0.5, 5); // 1 win / (1 win + 1 loss)
  });

  it("sums total P&L and computes the average per trade", () => {
    const entries = [makeEntry({ profitLoss: 100 }), makeEntry({ profitLoss: -40 })];
    const stats = computeJournalStatistics(entries);
    expect(stats.totalPnl).toBe(60);
    expect(stats.averagePnl).toBe(30);
  });

  it("computes plan-following rate correctly", () => {
    const entries = [
      makeEntry({ followedPlan: true }),
      makeEntry({ followedPlan: true }),
      makeEntry({ followedPlan: false }),
      makeEntry({ followedPlan: false }),
    ];
    const stats = computeJournalStatistics(entries);
    expect(stats.planFollowingRate).toBe(0.5);
  });

  it("tallies mistake categories", () => {
    const entries = [
      makeEntry({ mistakeCategory: "Overtrading" }),
      makeEntry({ mistakeCategory: "Overtrading" }),
      makeEntry({ mistakeCategory: "Chased price" }),
      makeEntry({ mistakeCategory: null }),
    ];
    const stats = computeJournalStatistics(entries);
    expect(stats.mistakeCounts["Overtrading"]).toBe(2);
    expect(stats.mistakeCounts["Chased price"]).toBe(1);
    expect(stats.mistakeCounts["null"]).toBeUndefined();
  });
});
