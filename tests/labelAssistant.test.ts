import { describe, expect, it } from "vitest";
import { backdateContiguousMove, generateLabelCandidates, labelsFromExecutedTrades } from "@/lib/replay/labelAssistant";
import type { Candle } from "@/types/candle";
import type { RecordedSession } from "@/lib/replay/types";
import type { JournalEntry } from "@/types/journal";

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const bar = (time: number, close: number, volume = 100): Candle => ({ time, open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume });

function session(): RecordedSession {
  const start = epoch("2025-08-15T13:30:00Z");
  const regular = Array.from({ length: 60 }, (_, index) => bar(start + index * 60, 100 + index * 0.12, index === 8 ? 1000 : 100));
  const flat = Array.from({ length: 60 }, (_, index) => bar(start + index * 60, 50 + Math.sin(index) * 0.03));
  const dailyStart = epoch("2025-07-20T20:00:00Z");
  const daily = Array.from({ length: 20 }, (_, index) => ({ time: dailyStart + index * 86_400, open: 95, high: 101, low: 94, close: 100, volume: 1000 }));
  return { schemaVersion: 1, tradingDate: "2025-08-15", feed: "sip", adjustment: "split", source: "historical_pull", recordedAt: "2025-08-16T00:00:00Z", bars: { MOVE: { "1m": regular, "1d": daily }, FLAT: { "1m": flat, "1d": daily } } };
}

describe("§2.3b label assistant", () => {
  it("back-dates to the first contiguous move bar instead of the threshold crossing", () => {
    const bars = [100, 100.1, 100.4, 100.8, 101.3].map((close, index) => bar(index * 60, close));
    expect(backdateContiguousMove(bars, 0, 4, "bullish", 2, 0.15)).toBe(0);
  });

  it("selects movement candidates, excludes executed symbols, and never auto-accepts", () => {
    const result = generateLabelCandidates(session(), ["FLAT"], { topRangePercentile: 0.9, windowMinutes: 30, windowTravelAtr: 0.3, maxBackdatePullbackAtr: 0.15, volumeWakeupMultiple: 2, openingRangeMinutes: 15 });
    expect(result.candidates.map((candidate) => candidate.symbol)).toEqual(["MOVE"]);
    expect(result.candidates[0]).toMatchObject({ decision: "pending", direction: "bullish" });
    expect(result.candidates[0].time_it_became_interesting).not.toBe("10:29:00");
    expect(result.candidates[0].sparkline.prices.length).toBeGreaterThan(0);
  });

  it("imports only trades with an actual entry timestamp and marks selection bias", () => {
    const base: JournalEntry = { id: "trade-1", tradeDate: "2025-08-15", entryTime: "2025-08-15T14:03:00Z", symbol: "nvda", direction: "long", entryPrice: 1, exitPrice: null, positionSize: 1, stopLoss: null, profitLoss: 0, setupScoreAtEntry: null, conditionsPassed: [], conditionsMissing: [], screenshotUrl: null, notes: null, emotionalState: null, followedPlan: true, mistakeCategory: null, lessonLearned: null, tags: [], createdAt: "2025-08-15T20:00:00Z" };
    const result = labelsFromExecutedTrades([base, { ...base, id: "trade-2", symbol: "AMD", entryTime: null }], "2025-08-15");
    expect(result.labels).toHaveLength(1);
    expect(result.labels[0]).toMatchObject({ symbol: "NVDA", source: "executed_trade", selectionBiased: true, time_i_actually_noticed: "10:03:00" });
    expect(result.skipped).toEqual([{ id: "trade-2", symbol: "AMD", reason: "missing_entry_time" }]);
  });
});
