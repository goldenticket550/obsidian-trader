import { describe, it, expect } from "vitest";
import {
  scoreSetup,
  computeWeightedScore,
  determineConvictionLevel,
  determineEntryStatus,
  determineInvalidationNote,
} from "@/lib/strategies/scorer";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { flatSeries, textbookBullishReclaimSeries, makeCandle } from "@/lib/fixtures/candles";
import type { SetupCondition } from "@/types/setup";

describe("scoreSetup", () => {
  it("returns an empty red result when there are no session candles", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: [],
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
    expect(result.status).toBe("red");
    expect(result.score).toBe(0);
    expect(result.conditions.length).toBe(0);
  });

  it("produces one condition entry per rule, including Strat and VWAP confirmations", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: flatSeries(30, 100),
      dailyCandles: flatSeries(25, 100),
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
    // 10 core conditions + optional Strat + optional VWAP confirmations.
    expect(result.conditions.length).toBe(12);
    const ids = result.conditions.map((c) => c.id);
    expect(ids).toContain("daily_sma_confirmation");
    expect(ids).toContain("strat_confirmation");
    expect(ids).toContain("vwap_reclaim");
  });

  it("stays red on a flat, uneventful session (no required conditions pass)", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: flatSeries(30, 100),
      dailyCandles: flatSeries(25, 100),
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
    expect(result.status).toBe("red");
  });

  it("passes decline, recovery, and consecutive-bullish on the textbook series", () => {
    const candles = textbookBullishReclaimSeries();
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: candles,
      dailyCandles: flatSeries(25, 95), // price ends above this, daily SMA should pass too
      prevClose: 110,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });

    const byId = Object.fromEntries(result.conditions.map((c) => [c.id, c]));
    expect(byId.intraday_decline.state).toBe("pass");
    expect(byId.recovery_from_low.state).toBe("pass");
    expect(byId.consecutive_bullish.state).toBe("pass");
    // Status should be at least yellow (some but maybe not all required conditions pass).
    expect(["yellow", "green"]).toContain(result.status);
    expect(result.score).toBeGreaterThan(0);
  });

  it("never lets an optional confirmation push status to green on its own", () => {
    // Flat series with no required conditions passing — even if volume or
    // strat happens to fire, status must not become green.
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: flatSeries(30, 100),
      dailyCandles: flatSeries(25, 105), // price below daily SMA, but irrelevant to this check
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
    expect(result.status).not.toBe("green");
  });

  // Regression tests for a real bug found against the live Alpaca API:
  // quality was hardcoded to "simulated" regardless of what was passed
  // in, mislabeling real live data as mock in the UI.
  it("passes through 'realtime' quality instead of hardcoding 'simulated'", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: flatSeries(30, 100),
      dailyCandles: flatSeries(25, 100),
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "realtime",
    });
    expect(result.quality).toBe("realtime");
  });

  it("passes through 'delayed' quality on the empty-candles path too", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: [],
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "delayed",
    });
    expect(result.quality).toBe("delayed");
  });

  // Regression tests for a real bug found in production: alerts and the
  // UI had no way to distinguish "just calculated from fresh data" from
  // "calculated right now, but from Friday's closing candle because
  // markets are closed" — both looked identical since only scan time
  // (lastUpdated) was tracked, not the underlying market data's time.
  it("computes latestCandleTime from the most recent session candle, distinct from 'now'", () => {
    const candles = flatSeries(10, 100); // times 0, 300, 600, ... 2700 (seconds)
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: candles,
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-07-19T12:00:00Z", // scan runs "now", far from the candle times
      quality: "simulated",
    });
    const expectedCandleTime = new Date(candles[candles.length - 1].time * 1000).toISOString();
    expect(result.latestCandleTime).toBe(expectedCandleTime);
    expect(result.latestCandleTime).not.toBe(result.lastUpdated);
  });

  it("sets latestCandleTime to null when there are no candles to derive it from", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: [],
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
    expect(result.latestCandleTime).toBeNull();
  });

  // Documentation/regression tests for Finding 2 of the Codex review of
  // e6c5acd: latestCandleTime is the timestamp a candle STARTED (Alpaca bar
  // semantics — a bar covers [time, time + duration)), not an "as of"
  // instant of the latest price. The UI label was renamed from "Market data
  // as of" to "Latest candle started" to reflect this; these tests pin the
  // underlying semantics down so a future change can't silently drift back
  // to implying the timestamp is the bar's close.
  it("for a 5-minute timeframe, latestCandleTime is the candle's open, up to ~5 minutes behind the true edge of the data", () => {
    const barOpen = "2026-07-19T14:35:00Z";
    const barOpenSeconds = Math.floor(new Date(barOpen).getTime() / 1000);
    // Genuinely 5-minute-spaced candles: last candle opens at barOpenSeconds.
    const candles = flatSeries(3, 100, barOpenSeconds - 2 * 300, 300);
    expect(candles[1].time - candles[0].time).toBe(300);
    expect(candles[2].time - candles[1].time).toBe(300);
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: candles,
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      // "now" is late in the still-forming bar — up to just under 5 minutes
      // of real price action has happened since latestCandleTime.
      now: "2026-07-19T14:39:59Z",
      quality: "simulated",
    });
    expect(result.latestCandleTime).toBe("2026-07-19T14:35:00.000Z");
  });

  it("for a 15-minute timeframe, latestCandleTime is the candle's open, up to ~15 minutes behind the true edge of the data", () => {
    const barOpen = "2026-07-19T14:15:00Z";
    const barOpenSeconds = Math.floor(new Date(barOpen).getTime() / 1000);
    // Genuinely 15-minute-spaced candles (900s apart) — not the 5-minute
    // spacing this fixture defaults to, which would silently pass this test
    // without proving the 15m case is handled correctly.
    const candles = flatSeries(3, 100, barOpenSeconds - 2 * 900, 900);
    expect(candles[1].time - candles[0].time).toBe(900);
    expect(candles[2].time - candles[1].time).toBe(900);
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "15m",
      sessionCandles: candles,
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      // "now" is late in the still-forming 15-minute bar.
      now: "2026-07-19T14:29:59Z",
      quality: "simulated",
    });
    expect(result.latestCandleTime).toBe("2026-07-19T14:15:00.000Z");
  });

  // Tests for weighted scoring, conviction level, entry status, and
  // invalidation notes - the "richer checklist" upgrade. Rewritten after
  // a Codex review found several of these could pass without proving
  // their named behavior (conditional assertions that could execute
  // zero real checks). Now using the exported pure functions directly
  // with hand-built, deterministic inputs wherever possible, so these
  // tests fail if the corresponding production logic is removed or
  // reversed.
  it("normalizes the weighted score to a fixed 0-10 scale regardless of condition count", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: textbookBullishReclaimSeries(),
      dailyCandles: flatSeries(25, 95),
      prevClose: 110,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
    expect(result.maxScore).toBe(10);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  describe("computeWeightedScore", () => {
    it("scores equal counts of higher-weight (core) conditions higher than lower-weight (supporting) ones", () => {
      // Same mixed condition set in both cases (one core, one
      // supporting) - only WHICH one passes differs. If a core
      // condition passing counts for more than a supporting one, "core
      // passes" must score strictly higher than "supporting passes."
      const corePassing: SetupCondition[] = [
        { id: "core1", label: "core1", state: "pass", required: true, category: "core" },
        { id: "supporting1", label: "supporting1", state: "fail", required: true, category: "supporting" },
      ];
      const supportingPassing: SetupCondition[] = [
        { id: "core1", label: "core1", state: "fail", required: true, category: "core" },
        { id: "supporting1", label: "supporting1", state: "pass", required: true, category: "supporting" },
      ];

      const coreResult = computeWeightedScore(corePassing);
      const supportingResult = computeWeightedScore(supportingPassing);

      expect(coreResult.score).toBeGreaterThan(supportingResult.score);
      // Concrete expected values: core weight 3, supporting weight 1,
      // total weight 4 either way -> (3/4)*10=7.5 vs (1/4)*10=2.5.
      expect(coreResult.score).toBeCloseTo(7.5, 5);
      expect(supportingResult.score).toBeCloseTo(2.5, 5);
    });

    it("always returns maxScore of 10", () => {
      const oneCondition: SetupCondition[] = [
        { id: "a", label: "a", state: "pass", required: true, category: "informational" },
      ];
      const manyConditions: SetupCondition[] = Array.from({ length: 12 }, (_, i) => ({
        id: `c${i}`,
        label: `c${i}`,
        state: "pass" as const,
        required: true,
        category: "core" as const,
      }));
      expect(computeWeightedScore(oneCondition).maxScore).toBe(10);
      expect(computeWeightedScore(manyConditions).maxScore).toBe(10);
    });

    it("returns 0 for an empty condition list without dividing by zero", () => {
      expect(computeWeightedScore([]).score).toBe(0);
    });
  });

  describe("determineConvictionLevel", () => {
    it("returns 'confirmed' whenever status is green, regardless of the counts given", () => {
      expect(determineConvictionLevel("green", 0, 0)).toBe("confirmed");
      expect(determineConvictionLevel("green", 7, 7)).toBe("confirmed");
    });

    it("returns 'developing' once at least half of required conditions pass", () => {
      expect(determineConvictionLevel("yellow", 4, 7)).toBe("developing");
    });

    it("returns 'developing' once at least 2 required conditions pass, even below half", () => {
      expect(determineConvictionLevel("yellow", 2, 10)).toBe("developing");
    });

    it("returns 'watch' when few required conditions pass", () => {
      expect(determineConvictionLevel("red", 0, 7)).toBe("watch");
      expect(determineConvictionLevel("yellow", 1, 10)).toBe("watch");
    });
  });

  describe("determineEntryStatus", () => {
    it("directly produces 'invalidated' whenever anyInvalidated is true, regardless of status", () => {
      const result = determineEntryStatus({
        sessionCandles: flatSeries(20, 100),
        anyInvalidated: true,
        status: "green",
        config: defaultStrategyConfig,
      });
      expect(result).toBe("invalidated");
    });

    it("directly produces 'wait_for_pullback' when status is not green", () => {
      const result = determineEntryStatus({
        sessionCandles: flatSeries(20, 100),
        anyInvalidated: false,
        status: "yellow",
        config: defaultStrategyConfig,
      });
      expect(result).toBe("wait_for_pullback");
    });

    it("directly produces 'actionable_now' when price sits close to its own EMA", () => {
      // Flat series: price stays at 100 throughout, so price ≈ EMA and
      // the distance-in-ATRs is ~0 - well within the extension threshold.
      const result = determineEntryStatus({
        sessionCandles: flatSeries(30, 100),
        anyInvalidated: false,
        status: "green",
        config: defaultStrategyConfig,
      });
      expect(result).toBe("actionable_now");
    });

    it("directly produces 'extended_do_not_chase' when price has run far beyond its own EMA relative to ATR", () => {
      // A quiet, low-ATR base followed by one huge spike candle - price
      // ends up many ATRs away from the (much slower-moving) EMA.
      const base = flatSeries(20, 100);
      const spike = makeCandle({ time: 20 * 300, open: 100, close: 150, high: 151, low: 99 });
      const candles = [...base, spike];

      const result = determineEntryStatus({
        sessionCandles: candles,
        anyInvalidated: false,
        status: "green",
        config: defaultStrategyConfig,
      });
      expect(result).toBe("extended_do_not_chase");
    });

    it("defaults to 'actionable_now' when there isn't enough data to judge extension", () => {
      const result = determineEntryStatus({
        sessionCandles: flatSeries(3, 100), // too short for a real ATR/EMA
        anyInvalidated: false,
        status: "green",
        config: defaultStrategyConfig,
      });
      expect(result).toBe("actionable_now");
    });
  });

  describe("determineInvalidationNote", () => {
    it("returns null when status is red", () => {
      const note = determineInvalidationNote({
        structureTriggerLevel: null,
        sessionLow: 100,
        hasGap: false,
        emaValue: null,
        status: "red",
      });
      expect(note).toBeNull();
    });

    it("returns a real note referencing the gap when status is green and a gap exists", () => {
      const note = determineInvalidationNote({
        structureTriggerLevel: 110,
        sessionLow: 100,
        hasGap: true,
        emaValue: 105,
        status: "green",
      });
      expect(note).not.toBeNull();
      expect(note).toMatch(/fair value gap/i);
    });

    it("returns a real note referencing the swing high when still developing", () => {
      const note = determineInvalidationNote({
        structureTriggerLevel: 110,
        sessionLow: 100,
        hasGap: false,
        emaValue: null,
        status: "yellow",
      });
      expect(note).not.toBeNull();
      expect(note).toContain("$110.00");
    });
  });
});
