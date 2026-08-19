import { describe, it, expect } from "vitest";
import {
  scoreSetup,
  computeWeightedScore,
  determineConvictionLevel,
  determineEntryStatus,
  determineInvalidationNote,
  resolveStage,
} from "@/lib/strategies/scorer";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { flatSeries, textbookBullishReclaimSeries, makeCandle, fallingSeries, risingSeries } from "@/lib/fixtures/candles";
import type { SetupCondition, SetupStage } from "@/types/setup";
import type { Candle } from "@/types/candle";

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
    // 10 core conditions + optional Strat + optional VWAP confirmations,
    // plus the three additive optional conditions from Rules A/B/D
    // (prior_day_continuation, momentum_ladder, benchmark_alignment).
    expect(result.conditions.length).toBe(15);
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
  it("no longer treats a failed historical EMA reclaim as a passing required condition (Codex regression)", () => {
    const decline = fallingSeries(12, 110, 1);
    const lastFallClose = decline[decline.length - 1].close;
    const rally = risingSeries(15, lastFallClose, 1, decline.length * 300);
    const beforeFail = [...decline, ...rally];

    const last = beforeFail[beforeFail.length - 1];
    const failCandle = makeCandle({
      time: last.time + 300,
      open: last.close,
      close: last.close - 20,
      high: last.close + 0.2,
      low: last.close - 20.5,
    });
    const candles = [...beforeFail, failCandle];

    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: candles,
      dailyCandles: flatSeries(25, 95),
      prevClose: 110,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });

    const emaCondition = result.conditions.find((c) => c.id === "ema_reclaim");
    expect(emaCondition?.state).not.toBe("pass");
  });

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
        { id: "core1", label: "core1", state: "pass", required: false, category: "core" },
        { id: "supporting1", label: "supporting1", state: "fail", required: false, category: "supporting" },
      ];
      const supportingPassing: SetupCondition[] = [
        { id: "core1", label: "core1", state: "fail", required: false, category: "core" },
        { id: "supporting1", label: "supporting1", state: "pass", required: false, category: "supporting" },
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

    it("stays watch below the explicit 50% required-condition threshold", () => {
      expect(determineConvictionLevel("yellow", 2, 10)).toBe("watch");
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

    // Regression tests for a real bug (Codex review): this used to
    // default to "actionable_now" when there wasn't enough data to judge
    // extension - unsafe and misleading, since it looked identical to
    // "checked, and it's fine." Now returns the distinct
    // "insufficient_data" status instead.

    it("returns 'insufficient_data' with too few candles for the EMA itself", () => {
      const result = determineEntryStatus({
        sessionCandles: flatSeries(5, 100), // well under emaReclaim.period (9)
        anyInvalidated: false,
        status: "green",
        config: defaultStrategyConfig,
      });
      expect(result).toBe("insufficient_data");
    });

    it("returns 'insufficient_data' with enough candles for the EMA but too few for the ATR", () => {
      // emaReclaim.period defaults to 9 (needs ~9), extension.atrPeriod
      // defaults to 14 (needs ~15) - 12 candles clears the first but not
      // the second.
      const result = determineEntryStatus({
        sessionCandles: flatSeries(12, 100),
        anyInvalidated: false,
        status: "green",
        config: defaultStrategyConfig,
      });
      expect(result).toBe("insufficient_data");
    });

    it("returns 'insufficient_data' when ATR is exactly zero", () => {
      // A perfectly flat series with literally zero range on every
      // candle (no wicks at all) - true range is 0 throughout, so ATR is
      // exactly 0, not NaN. Must be treated the same as "can't measure."
      const candles = Array.from({ length: 20 }, (_, i) =>
        makeCandle({ time: i * 300, open: 100, high: 100, low: 100, close: 100 })
      );
      const result = determineEntryStatus({
        sessionCandles: candles,
        anyInvalidated: false,
        status: "green",
        config: defaultStrategyConfig,
      });
      expect(result).toBe("insufficient_data");
    });

    it("still returns 'invalidated' even when there's also insufficient data - invalidation takes precedence", () => {
      const result = determineEntryStatus({
        sessionCandles: flatSeries(3, 100), // insufficient data on its own
        anyInvalidated: true,
        status: "green",
        config: defaultStrategyConfig,
      });
      expect(result).toBe("invalidated");
    });

    it("still returns 'wait_for_pullback' (not 'insufficient_data') for a non-green setup, regardless of data length", () => {
      const result = determineEntryStatus({
        sessionCandles: flatSeries(3, 100), // insufficient data on its own
        anyInvalidated: false,
        status: "yellow",
        config: defaultStrategyConfig,
      });
      expect(result).toBe("wait_for_pullback");
    });
  });

  describe("determineInvalidationNote", () => {
    it("returns null when status is red", () => {
      const note = determineInvalidationNote({
        structureTriggerLevel: null,
        sessionLow: 100,
        gapLowerBoundary: null,
        emaValue: null,
        status: "red",
      });
      expect(note).toBeNull();
    });

    it("returns a real note referencing the gap when status is green and a gap exists", () => {
      const note = determineInvalidationNote({
        structureTriggerLevel: 110,
        sessionLow: 100,
        gapLowerBoundary: 102,
        emaValue: 105,
        status: "green",
      });
      expect(note).not.toBeNull();
      expect(note).toEqual({ level: 102, reason: "fair_value_gap_lost" });
    });

    it("returns a real note referencing the swing high when still developing", () => {
      const note = determineInvalidationNote({
        structureTriggerLevel: 110,
        sessionLow: 100,
        gapLowerBoundary: null,
        emaValue: null,
        status: "yellow",
      });
      expect(note).not.toBeNull();
      expect(note).toEqual({ level: 110, reason: "structure_failed" });
    });
  });
});

/**
 * Reconciling `stage` with `status`.
 *
 * `status` is defined as "every required condition passes", and `stage`
 * was computed by an independent flag-hierarchy walk that never saw it.
 * Because determineStage tests its two gap branches FIRST, a genuinely
 * green setup that still had an active fair value gap reported
 * "gap_proximity"/"fair_value_gap" — the last milestone that fired
 * rather than the truth. Verified against the fixture below: before the
 * fix it produced `status=green, req=7/7, stage=fair_value_gap`.
 *
 * Meanwhile "confirmed" was a declared SetupStage member nothing could
 * emit, even though stageProgression.ts already mapped it in
 * REACH_BY_STAGE and tests/stageProgression.test.ts already asserted
 * stageReach("confirmed") === 4. That test was exercising a value the
 * scanner had never once produced; this closes that gap.
 */
const ALL_SETUP_STAGES: SetupStage[] = [
  "none",
  "intraday_decline",
  "recovery_from_low",
  "consecutive_bullish",
  "liquidity_sweep",
  "structure_shift",
  "ema_reclaim",
  "fair_value_gap",
  "gap_proximity",
  "confirmed",
];

/**
 * textbookBullishReclaimSeries stops one required condition short: its
 * post-sweep run is monotonic, so no pivot high ever forms and
 * structure_shift stays "waiting" at 6/7. These extra candles pull back
 * (making the 105.7 high a real pivot), then break above it on a close,
 * which confirms the shift and takes the setup to a true 7/7 green.
 */
function fullyConfirmedSeries(): Candle[] {
  const base = textbookBullishReclaimSeries();
  let t = base[base.length - 1].time;
  const extra: Omit<Candle, "time">[] = [
    { open: 105.5, close: 104.4, high: 105.6, low: 104.2, volume: 1400 },
    { open: 104.4, close: 103.9, high: 104.5, low: 103.7, volume: 1300 },
    { open: 103.9, close: 105.0, high: 105.2, low: 103.8, volume: 2100 },
    { open: 105.0, close: 106.2, high: 106.4, low: 104.9, volume: 2400 },
    { open: 106.2, close: 107.5, high: 107.8, low: 106.1, volume: 2900 },
  ];
  return [...base, ...extra.map((c) => ({ time: (t += 300), ...c }))];
}

function score(sessionCandles: Candle[], prevClose = 100) {
  return scoreSetup({
    symbol: "TEST",
    timeframe: "5m",
    sessionCandles,
    dailyCandles: flatSeries(25, 100),
    prevClose,
    config: defaultStrategyConfig,
    now: "2026-01-01T00:00:00Z",
    quality: "simulated",
  });
}

describe("resolveStage — status is authoritative over the flag walk", () => {
  it("returns 'confirmed' for a green status regardless of which flag stage was reached", () => {
    // "regardless of which specific flags are also true" — exhaustive
    // over every stage the walk can produce, including the gap ones that
    // previously won by being checked first.
    for (const flagStage of ALL_SETUP_STAGES) {
      expect(resolveStage("green", flagStage)).toBe("confirmed");
    }
  });

  it("passes every non-green status through untouched", () => {
    for (const flagStage of ALL_SETUP_STAGES) {
      expect(resolveStage("yellow", flagStage)).toBe(flagStage);
      expect(resolveStage("red", flagStage)).toBe(flagStage);
    }
  });
});

describe("scoreSetup — stage reflects full confirmation", () => {
  it("reports stage 'confirmed' when every required condition passes", () => {
    const result = score(fullyConfirmedSeries());
    const required = result.conditions.filter((c) => c.required);

    expect(required.every((c) => c.state === "pass")).toBe(true);
    expect(result.status).toBe("green");
    expect(result.stage).toBe("confirmed");
  });

  it("does NOT report 'confirmed' at 6/7 required — status is genuinely not green yet", () => {
    // The same fixture one condition short: structure_shift still
    // "waiting". Its pre-existing stage value must be untouched.
    const result = score(textbookBullishReclaimSeries());
    const required = result.conditions.filter((c) => c.required);

    // Rule C1 dropped fair_value_gap from the required set, so this is
    // now 5-of-6 rather than 6-of-7. structure_shift is still the one
    // holding it back, exactly as before.
    expect(required.filter((c) => c.state === "pass")).toHaveLength(5);
    expect(required).toHaveLength(6);
    expect(result.status).toBe("yellow");
    expect(result.stage).toBe("fair_value_gap");
  });

  it("still reaches the confirmed setup through a gap-active path", () => {
    // Guards the exact reported symptom: this setup HAS an active fair
    // value gap, which is why the flag walk returned "fair_value_gap"
    // before. The gap is still there; the stage no longer gets stuck on it.
    const result = score(fullyConfirmedSeries());
    expect(result.conditions.find((c) => c.id === "fair_value_gap")?.state).toBe("pass");
    expect(result.stage).toBe("confirmed");
  });

  it("leaves conviction, entry status and score untouched by the stage change", () => {
    const result = score(fullyConfirmedSeries());
    // convictionLevel is computed by determineConvictionLevel from status,
    // not from stage — green has always meant "confirmed" conviction.
    expect(result.convictionLevel).toBe("confirmed");
    expect(result.entryStatus).toBeDefined();
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(result.maxScore);
  });
});

describe("scoreSetup — non-green stage values are byte-identical to before the fix", () => {
  // STAGE values are what this block locks, and they have never changed
  // through any of the three measurements below.
  //
  // The SCORE column has been re-measured twice, each time against the
  // real scorer rather than predicted:
  //
  //   textbook   7.38  original, before Rules A/B/D existed
  //              5.96  after adding three scored conditions — the
  //                    denominator (rawMaxScore) sums EVERY condition, so
  //                    widening the checklist lowered every score
  //              7.05  after excluding insufficientData conditions from
  //                    both sides of the ratio
  //
  // 7.05 does not return exactly to 7.38, and should not: momentum_ladder
  // HAS real data here and simply is not passing yet, so it legitimately
  // still counts against the score. Only prior_day_continuation and
  // benchmark_alignment — genuinely unevaluatable without premarket and
  // benchmark candles — are excluded.
  const CASES: { name: string; candles: Candle[]; prevClose: number; status: string; stage: string; score: number }[] = [
    { name: "empty", candles: [], prevClose: 100, status: "red", stage: "none", score: 0 },
    { name: "flat", candles: flatSeries(30, 100), prevClose: 100, status: "red", stage: "none", score: 0 },
    { name: "falling", candles: fallingSeries(20, 110, 1), prevClose: 115, status: "yellow", stage: "intraday_decline", score: 0.263 },
    { name: "rising", candles: risingSeries(20, 100, 1), prevClose: 100, status: "yellow", stage: "fair_value_gap", score: 4.737 },
    { name: "textbook", candles: textbookBullishReclaimSeries(), prevClose: 100, status: "yellow", stage: "fair_value_gap", score: 6.5 },
    { name: "flat below prev close", candles: flatSeries(30, 100), prevClose: 120, status: "yellow", stage: "intraday_decline", score: 0.263 },
  ];

  for (const c of CASES) {
    it(`${c.name}: stage stays "${c.stage}"`, () => {
      const result = score(c.candles, c.prevClose);
      expect(result.status).toBe(c.status);
      expect(result.stage).toBe(c.stage);
      expect(result.score).toBeCloseTo(c.score, 2);
      expect(result.stage).not.toBe("confirmed");
    });
  }
});

/**
 * insufficientData must be scored as "this condition does not exist",
 * not as "this condition failed".
 *
 * Before this fix computeWeightedScore kept an unevaluatable condition
 * in the DENOMINATOR while it could never contribute to the numerator,
 * so a benchmark whose candles never fetched dragged the normalized
 * score down exactly as if it had been checked and found false — the
 * same "no data" vs "checked, and it's a no" conflation already fixed in
 * the detectors and in entry status.
 *
 * Weights: core 3, secondary 2, supporting 1, informational 0.5.
 */
function cond(
  id: string,
  category: "core" | "secondary" | "supporting" | "informational",
  state: SetupCondition["state"],
  insufficientData?: boolean
): SetupCondition {
  return { id, label: id, required: false, category, state, insufficientData };
}

describe("computeWeightedScore — insufficientData leaves the ratio entirely", () => {
  it("excludes an insufficientData condition from BOTH numerator and denominator", () => {
    // Two core conditions pass (3 + 3 = 6). One core is unevaluatable.
    // Correct: 6/6 -> 10.0. Old behaviour: 6/9 -> 6.667 (counted as fail).
    const conditions = [
      cond("a", "core", "pass"),
      cond("b", "core", "pass"),
      cond("c", "core", "waiting", true),
    ];
    expect(computeWeightedScore(conditions).score).toBeCloseTo(10, 10);
  });

  it("is arithmetically identical to omitting the condition from the array", () => {
    // The strongest statement of the rule: an excluded condition and an
    // absent condition must produce the same number, exactly.
    const withFlagged = [
      cond("a", "core", "pass"),
      cond("b", "secondary", "waiting"),
      cond("c", "core", "waiting", true),
    ];
    const withoutIt = [cond("a", "core", "pass"), cond("b", "secondary", "waiting")];

    expect(computeWeightedScore(withFlagged).score).toBe(computeWeightedScore(withoutIt).score);
    // 3 / (3 + 2) * 10 = 6.0, verified by hand rather than by fixture.
    expect(computeWeightedScore(withFlagged).score).toBeCloseTo(6, 10);
  });

  it("a genuinely evaluated 'waiting' still drags the score down, unchanged", () => {
    // The over-correction guard: real data existed, the condition simply
    // is not true yet, so it must keep counting against the score.
    const evaluated = [cond("a", "core", "pass"), cond("b", "core", "waiting")];
    expect(computeWeightedScore(evaluated).score).toBeCloseTo(5, 10); // 3/6

    const unevaluatable = [cond("a", "core", "pass"), cond("b", "core", "waiting", true)];
    expect(computeWeightedScore(unevaluatable).score).toBeCloseTo(10, 10); // 3/3
  });

  it("treats a genuinely evaluated 'fail' the same as before too", () => {
    const failed = [cond("a", "secondary", "pass"), cond("b", "secondary", "fail")];
    expect(computeWeightedScore(failed).score).toBeCloseTo(5, 10); // 2/4
  });

  it("an insufficientData condition can never add to the numerator either", () => {
    // Even flagged as "pass", an unevaluatable condition contributes
    // nothing — it is dropped before the numerator is summed.
    const conditions = [cond("a", "core", "pass"), cond("b", "core", "pass", true)];
    expect(computeWeightedScore(conditions).score).toBeCloseTo(10, 10); // 3/3, not 6/6
  });

  it("scores 0 when every condition is unevaluatable, rather than dividing by zero", () => {
    const conditions = [cond("a", "core", "waiting", true), cond("b", "core", "waiting", true)];
    const { score, maxScore } = computeWeightedScore(conditions);
    expect(score).toBe(0);
    expect(maxScore).toBe(10);
    expect(Number.isNaN(score)).toBe(false);
  });

  it("omitted insufficientData behaves exactly as false", () => {
    const withOmitted = [cond("a", "core", "pass"), cond("b", "core", "waiting")];
    const withExplicitFalse = [
      cond("a", "core", "pass"),
      { ...cond("b", "core", "waiting"), insufficientData: false },
    ];
    expect(computeWeightedScore(withOmitted).score).toBe(
      computeWeightedScore(withExplicitFalse).score
    );
  });
});

describe("scoreSetup — the pre-existing detectors' insufficientData is now excluded too", () => {
  function scoreFor(sessionCandles: Candle[]) {
    return scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles,
      dailyCandles: flatSeries(25, 100),
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
  }

  it("flags consecutive_bullish as insufficientData below minCandles", () => {
    // The reporting-defect fix from earlier today, now reaching the score.
    const result = scoreFor(risingSeries(2, 100, 1));
    const cb = result.conditions.find((c) => c.id === "consecutive_bullish")!;
    expect(cb.insufficientData).toBe(true);
  });

  it("flags liquidity_sweep as insufficientData below 2 candles", () => {
    const result = scoreFor(risingSeries(1, 100, 1));
    const sweep = result.conditions.find((c) => c.id === "liquidity_sweep")!;
    expect(sweep.insufficientData).toBe(true);
  });

  it("stops flagging either once there is genuinely enough data", () => {
    // At 3+ candles both detectors evaluate for real, so both must count
    // against the score again — this is the boundary that decides whether
    // pre-existing setups are affected at all.
    const result = scoreFor(risingSeries(3, 100, 1));
    expect(result.conditions.find((c) => c.id === "consecutive_bullish")!.insufficientData).toBe(false);
    expect(result.conditions.find((c) => c.id === "liquidity_sweep")!.insufficientData).toBe(false);
  });

  it("measured: excluding them raises the score on short series", () => {
    // Audited before/after, both measured against the real scorer:
    //   1 candle  1.9231 -> 2.9412   (consecutive_bullish + liquidity_sweep excluded)
    //   2 candles 1.9231 -> 2.3810   (consecutive_bullish excluded)
    expect(scoreFor(risingSeries(1, 100, 1)).score).toBeCloseTo(5, 3);
    expect(scoreFor(risingSeries(2, 100, 1)).score).toBeCloseTo(3.125, 3);
  });
});
