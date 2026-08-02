import { describe, it, expect } from "vitest";
import {
  runReclaimMachine,
  clusterLevels,
  closeLocation,
  resetSeverityFor,
  selectMachineCandidate,
  isActiveStage,
  RECLAIM_STAGE_ORDER,
  type ReclaimMachineInput,
} from "@/lib/scanner/reclaimContinuation";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import type { Candle } from "@/types/candle";

/**
 * Reclaim & Continuation — the pure state machine, on one candle series.
 *
 * Deliberately NOT covered here (later pieces): the two-timeframe runner,
 * alignment, the shared 1-minute loader, alert gating, and the UI.
 */

const CONFIG = defaultStrategyConfig.reclaimContinuation;
/** A round ATR keeps every threshold in the fixtures readable in dollars. */
const ATR = 1.0;
const T0 = Math.floor(Date.parse("2026-07-13T13:30:00Z") / 1000);

function bar(index: number, o: number, h: number, l: number, c: number, v = 1000): Candle {
  return { time: T0 + index * 300, open: o, high: h, low: l, close: c, volume: v };
}

/** A flat filler bar at `price`, used to pad a series without adding signal. */
function flat(index: number, price: number): Candle {
  return bar(index, price, price + 0.02, price - 0.02, price);
}

function input(overrides: Partial<ReclaimMachineInput> = {}): ReclaimMachineInput {
  return {
    symbol: "TEST",
    sessionDate: "2026-07-13",
    direction: "bullish",
    timeframe: "five_minute",
    candles: [],
    atr: ATR,
    priorDayLevel: null,
    premarketLevel: null,
    premarketAvailableFromIndex: null,
    openingRangeLevel: null,
    openingRangeAvailableFromIndex: null,
    regularSessionStartIndex: null,
    structureLevel: null,
    sweepEvidence: null,
    // Completed data is not automatically fresh; fixtures state it.
    freshness: "real_time",
    volumePace: null,
    benchmarkRelativeMove: null,
    ...overrides,
  };
}

/**
 * A bullish sequence: a rise to an anchor high, a flush to a reset low,
 * then a recovery that closes strong. `depth` is in dollars (= ATR here).
 */
function bullishReset(depth: number): Candle[] {
  const anchor = 100;
  const low = anchor - depth;
  return [
    flat(0, 98),
    bar(1, 98, anchor, 97.8, 99.8), // anchor high
    bar(2, 99.8, 99.9, low + 0.4, low + 0.5),
    bar(3, low + 0.5, low + 0.6, low, low + 0.1), // reset low
  ];
}

/** The mirrored bearish sequence: a dip to an anchor low, then a squeeze up. */
function bearishReset(depth: number): Candle[] {
  const anchor = 100;
  const high = anchor + depth;
  return [
    flat(0, 102),
    bar(1, 102, 102.2, anchor, 100.2), // anchor low
    bar(2, 100.2, high - 0.4, 100.1, high - 0.5),
    bar(3, high - 0.5, high, high - 0.6, high - 0.1), // reset high
  ];
}

// ---------------------------------------------------------------------------
// Tests 1-6 — reset detection
// ---------------------------------------------------------------------------

describe("reset detection", () => {
  it("classifies a shallow bullish reset (test 1)", () => {
    const result = runReclaimMachine(input({ candles: bullishReset(0.45) }), CONFIG);
    expect(result.resetAtr).toBeCloseTo(0.45, 6);
    expect(result.resetSeverity).toBe("shallow");
    expect(result.stage).not.toBe("unavailable");
  });

  it("classifies a standard bullish reset (test 2)", () => {
    const result = runReclaimMachine(input({ candles: bullishReset(0.8) }), CONFIG);
    expect(result.resetAtr).toBeCloseTo(0.8, 6);
    expect(result.resetSeverity).toBe("standard");
  });

  it("classifies a deep bullish reset (test 3)", () => {
    const result = runReclaimMachine(input({ candles: bullishReset(1.4) }), CONFIG);
    expect(result.resetAtr).toBeCloseTo(1.4, 6);
    expect(result.resetSeverity).toBe("deep");
  });

  it("puts the severity boundaries exactly where the config says", () => {
    expect(resetSeverityFor(CONFIG.minResetAtr, CONFIG)).toBe("shallow");
    expect(resetSeverityFor(CONFIG.shallowResetMaxAtr - 1e-9, CONFIG)).toBe("shallow");
    expect(resetSeverityFor(CONFIG.shallowResetMaxAtr, CONFIG)).toBe("standard");
    expect(resetSeverityFor(CONFIG.standardResetMaxAtr - 1e-9, CONFIG)).toBe("standard");
    expect(resetSeverityFor(CONFIG.standardResetMaxAtr, CONFIG)).toBe("deep");
  });

  it("does not qualify a fixed-dollar move that is small against ATR (test 4)", () => {
    // $0.20 is a real dollar move but only 0.02 ATR on a $10 ATR name —
    // dollars are displayed evidence, never the qualification gate.
    const result = runReclaimMachine(
      input({ candles: bullishReset(0.2), atr: 10 }),
      CONFIG
    );
    expect(result.stage).toBe("unavailable");
    expect(result.unavailableReason).toBe("no_qualifying_reset");
    // ...and the same depth against a small ATR does qualify.
    expect(runReclaimMachine(input({ candles: bullishReset(0.2), atr: 0.4 }), CONFIG).stage)
      .not.toBe("unavailable");
  });

  it("keeps a seeded setup alive well past newResetMaxAgeBars (Part A test 2)", () => {
    // The eight-bar expiration bug: `newResetMaxAgeBars` gates SEEDING a
    // new setup, it does not expire one already under way. Padding far
    // past the window must not make an established setup vanish.
    const aged = [
      ...bullishReset(0.8),
      bar(4, 99.3, 99.95, 99.25, 99.9), // establishes exhaustion
      ...Array.from({ length: CONFIG.newResetMaxAgeBars + 4 }, (_, i) => flat(5 + i, 99.9)),
    ];
    const result = runReclaimMachine(input({ candles: aged }), CONFIG);

    expect(result.stage).not.toBe("unavailable");
    expect(RECLAIM_STAGE_ORDER[result.stage]).toBeGreaterThanOrEqual(
      RECLAIM_STAGE_ORDER.exhaustion
    );
    // The identity is still the original reset, many bars later.
    expect(result.resetExtremeTime).toBe(aged[3].time);
  });

  it("keeps the reset identity stable as later recovery candles arrive (test 6)", () => {
    const base = bullishReset(0.8);
    const first = runReclaimMachine(input({ candles: base }), CONFIG);
    const later = runReclaimMachine(
      input({ candles: [...base, bar(4, 99.3, 99.9, 99.2, 99.8), bar(5, 99.8, 100.4, 99.7, 100.3)] }),
      CONFIG
    );

    // A slightly higher recovery high must not re-anchor the setup.
    expect(later.resetAnchorTime).toBe(first.resetAnchorTime);
    expect(later.resetExtremeTime).toBe(first.resetExtremeTime);
    expect(later.setupKey).toBe(first.setupKey);
  });

  it("anchors chronologically, not on the deepest low found in hindsight", () => {
    const candles = [
      bar(0, 98, 101, 97.9, 100.8), // anchor high 101
      bar(1, 100.8, 100.9, 99.4, 99.5), // the reset as it stood at bar 1
      bar(2, 99.5, 100.2, 99.4, 100.1), // recovery -> exhaustion here
      bar(3, 100.1, 100.2, 99.0, 99.1), // a LOWER low, but arriving later
    ];
    const result = runReclaimMachine(input({ candles }), CONFIG);

    // The setup seeded at bar 1 and exhausted at bar 2, so its identity was
    // already fixed when bar 3 printed a lower low. A hindsight detector
    // would have re-anchored to bar 3's low and reported a deeper reset;
    // that is precisely the backward-looking behaviour being removed.
    expect(result.resetAnchorTime).toBe(candles[0].time);
    expect(result.resetExtremeTime).toBe(candles[1].time);
    expect(result.resetDollars).toBeCloseTo(101 - 99.4, 6);

    // Bar 3 closes through the locked invalidation, which terminates it.
    expect(result.stage).toBe("invalidated");
  });
});

// ---------------------------------------------------------------------------
// Tests 7-9 — exhaustion
// ---------------------------------------------------------------------------

describe("exhaustion", () => {
  it("does not treat continued selling as exhaustion (test 7)", () => {
    const candles = [
      ...bullishReset(0.8),
      bar(4, 99.3, 99.35, 98.6, 98.65), // still going down, closes near its low
      bar(5, 98.65, 98.7, 98.0, 98.05),
    ];
    const result = runReclaimMachine(input({ candles }), CONFIG);
    // A new lower extreme re-anchors the reset, but nothing has recovered.
    expect(result.stage).toBe("reset");
    expect(result.evidence.find((e) => e.name === "failedContinuation")!.state).toBe("waiting");
  });

  it("accepts a confirmed sweep and reclaim as exhaustion (test 8)", () => {
    // Path A: the existing sweep detector confirmed it. The recovery candle
    // here closes mid-range, so the close-location path alone would not fire.
    const candles = [...bullishReset(0.8), bar(4, 99.3, 99.7, 99.25, 99.4)];
    const withoutSweep = runReclaimMachine(input({ candles }), CONFIG);
    const withSweep = runReclaimMachine(input({ candles, sweepEvidence: {
          direction: "bullish",
          sweptLevel: 99.2,
          sweepCandleTime: candles[3].time,
          reclaimCandleTime: candles[4].time,
        } }), CONFIG);

    expect(RECLAIM_STAGE_ORDER[withSweep.stage]).toBeGreaterThanOrEqual(
      RECLAIM_STAGE_ORDER.exhaustion
    );
    expect(RECLAIM_STAGE_ORDER[withSweep.stage]).toBeGreaterThan(
      RECLAIM_STAGE_ORDER[withoutSweep.stage]
    );
  });

  it("cannot satisfy close-location exhaustion on a zero-range candle (test 9)", () => {
    expect(closeLocation({ time: 0, open: 5, high: 5, low: 5, close: 5, volume: 1 })).toBeNull();

    const flatRecovery: Candle = { time: T0 + 4 * 300, open: 99.9, high: 99.9, low: 99.9, close: 99.9, volume: 1000 };
    const result = runReclaimMachine(
      input({ candles: [...bullishReset(0.8), flatRecovery] }),
      CONFIG
    );
    // The recovery is large enough, but a bar with no range has no close
    // location — unavailable evidence, not a pass.
    expect(result.stage).toBe("reset");
  });

  it("computes close location identically for both directions", () => {
    const candle = bar(0, 10, 12, 10, 11.5);
    expect(closeLocation(candle)).toBeCloseTo(0.75, 6);
  });
});

// ---------------------------------------------------------------------------
// Tests 10-13 — reclaim of control levels
// ---------------------------------------------------------------------------

describe("reclaim", () => {
  /** A sequence that loses a structure level and then closes back above it. */
  function reclaimSequence(structure: number): Candle[] {
    return [
      ...bullishReset(0.8),
      bar(4, 99.3, 99.6, 99.2, 99.5), // still below `structure`
      bar(5, 99.5, 100.3, 99.45, 100.2), // crosses above on the close
      bar(6, 100.2, 100.5, 100.1, 100.4),
    ];
  }

  it("does not call a level reclaimed when price never lost it (test 10)", () => {
    // Price is above this structure level for the entire sequence, so
    // there is nothing to reclaim.
    const result = runReclaimMachine(
      input({ candles: reclaimSequence(90), structureLevel: 90 }),
      CONFIG
    );
    expect(result.structureReclaimed).toBe(false);
  });

  it("reports forming with one crossed control level (test 11)", () => {
    const result = runReclaimMachine(
      input({ candles: reclaimSequence(99.9), structureLevel: 99.9 }),
      CONFIG
    );
    expect(result.structureReclaimed).toBe(true);
    // Only structure crossed here; EMA/VWAP need a longer series.
    const crossed = [result.emaReclaimed, result.vwapReclaimed, result.structureReclaimed].filter(
      Boolean
    ).length;
    expect(crossed).toBe(1);
    expect(result.reclaimStatus).toBe("forming");
  });

  it("reports confirmed with two crossed control levels (test 12)", () => {
    // A long enough series for VWAP to be meaningful, losing then
    // reclaiming both VWAP and the structure level.
    const candles: Candle[] = [
      bar(0, 100, 100.2, 99.9, 100.1, 5000),
      bar(1, 100.1, 101.0, 100.0, 100.9, 5000), // anchor high 101
      bar(2, 100.9, 101.0, 100.0, 100.1, 5000),
      bar(3, 100.1, 100.2, 99.1, 99.2, 8000),
      bar(4, 99.2, 99.4, 99.0, 99.15, 8000), // reset low 99.0
      bar(5, 99.15, 99.9, 99.1, 99.85, 6000),
      bar(6, 99.85, 100.9, 99.8, 100.85, 6000), // closes back above VWAP + structure
      bar(7, 100.85, 101.1, 100.7, 101.0, 6000),
    ];
    const result = runReclaimMachine(
      input({ candles, structureLevel: 99.5 }),
      CONFIG
    );
    const crossed = [result.emaReclaimed, result.vwapReclaimed, result.structureReclaimed].filter(
      Boolean
    ).length;
    expect(crossed).toBeGreaterThanOrEqual(2);
    expect(result.reclaimStatus).toBe("confirmed");
  });

  it("leaves structure evidence unavailable when there is no structure level (test 13)", () => {
    const result = runReclaimMachine(
      input({ candles: reclaimSequence(99.9), structureLevel: null }),
      CONFIG
    );
    expect(result.structureLevel).toBeNull();
    expect(result.structureReclaimed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests 14-18 — tracked levels and clustering
// ---------------------------------------------------------------------------

describe("tracked levels", () => {
  const candles = [...bullishReset(0.8), bar(4, 99.3, 99.7, 99.2, 99.65)];

  it("omits an opening-range level that is not yet available (test 14)", () => {
    // The caller supplies null until all five 1m bars are complete.
    const result = runReclaimMachine(
      input({ candles, openingRangeLevel: null, premarketLevel: 100.5 }),
      CONFIG
    );
    expect(result.activeLevelSources).not.toContain("Opening-range high");
    expect(result.activeLevelSources).toContain("Premarket high");
  });

  it("excludes the current candle from the session extreme (test 15)", () => {
    // The last candle makes the highest high of the series; if it were
    // included, price could never be measured against the level it set.
    const withHighLast = [...candles, bar(5, 99.65, 105, 99.6, 104.9)];
    const result = runReclaimMachine(
      input({ candles: withHighLast, regularSessionStartIndex: 0 }),
      CONFIG
    );
    // The session high comes from bars before the last one, so it is not 105.
    const sessionLevel = result.activeLevelPrice;
    expect(sessionLevel === null || sessionLevel < 105).toBe(true);
  });

  it("groups nearby levels into one cluster, preserving both sources (test 16)", () => {
    const clusters = clusterLevels(
      [
        { name: "Premarket high", price: 100.0, availableFromIndex: 0 },
        { name: "Prior-day high", price: 100.03, availableFromIndex: 2 },
        { name: "Session high", price: 101.5, availableFromIndex: 0 },
      ],
      ATR,
      "bullish",
      CONFIG
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0].sources).toEqual(["Premarket high", "Prior-day high"]);
    expect(clusters[1].sources).toEqual(["Session high"]);
    // A cluster is usable only once EVERY member is available.
    expect(clusters[0].availableFromIndex).toBe(2);
  });

  it("does not reorder the caller's level array", () => {
    const levels = [
      { name: "Session high", price: 101.5, availableFromIndex: 0 },
      { name: "Premarket high", price: 100.0, availableFromIndex: 0 },
    ];
    clusterLevels(levels, ATR, "bullish", CONFIG);
    expect(levels.map((l) => l.name)).toEqual(["Session high", "Premarket high"]);
  });

  it("selects the nearest unbroken resistance above price (test 17)", () => {
    const result = runReclaimMachine(
      input({ candles, premarketLevel: 101.5, priorDayLevel: 100.2 }),
      CONFIG
    );
    expect(result.activeLevelPrice).toBe(100.2);
    expect(result.activeLevelSources).toEqual(["Prior-day high"]);
    expect(result.distanceToNextLevelDollars).toBeCloseTo(100.2 - 99.65, 6);
    expect(result.distanceToNextLevelAtr).toBeCloseTo((100.2 - 99.65) / ATR, 6);
  });

  it("reports being beyond all tracked levels without inventing a target (test 18)", () => {
    // Every tracked level sits below price and none was broken during this
    // setup, so there is nothing ahead to aim at.
    const result = runReclaimMachine(
      input({ candles, premarketLevel: 90, priorDayLevel: 91 }),
      CONFIG
    );
    expect(result.aboveAllTrackedLevels).toBe(true);
    expect(result.activeLevelPrice).toBeNull();
    expect(result.nextLevelPrice).toBeNull();
    expect(result.stage).not.toBe("level_test");
    expect(result.summary).toMatch(/already above all tracked resistance/i);
  });
});

// ---------------------------------------------------------------------------
// Tests 19-23 — level test, break, acceptance, continuation
// ---------------------------------------------------------------------------

describe("level test, acceptance and continuation", () => {
  /** Loses then reclaims VWAP and structure, ending just under `level`. */
  function confirmedReclaim(level: number): Candle[] {
    return [
      bar(0, 100, 100.2, 99.9, 100.1, 5000),
      bar(1, 100.1, 101.0, 100.0, 100.9, 5000),
      bar(2, 100.9, 101.0, 100.0, 100.1, 5000),
      bar(3, 100.1, 100.2, 99.1, 99.2, 8000),
      bar(4, 99.2, 99.4, 99.0, 99.15, 8000),
      bar(5, 99.15, 99.9, 99.1, 99.85, 6000),
      bar(6, 99.85, 100.9, 99.8, 100.85, 6000),
      bar(7, 100.85, level - 0.05, 100.7, level - 0.1, 6000),
    ];
  }

  it("reaches level_test only inside the configured distance (test 19)", () => {
    const near = runReclaimMachine(
      input({ candles: confirmedReclaim(101.2), structureLevel: 99.5, priorDayLevel: 101.2 }),
      CONFIG
    );
    expect(near.reclaimStatus).toBe("confirmed");
    expect(near.distanceToNextLevelAtr!).toBeLessThanOrEqual(CONFIG.levelTestDistanceAtr);
    expect(near.stage).toBe("level_test");

    // The same setup with the level far away stays at reclaim.
    const far = runReclaimMachine(
      input({ candles: confirmedReclaim(101.2), structureLevel: 99.5, priorDayLevel: 105 }),
      CONFIG
    );
    expect(far.distanceToNextLevelAtr!).toBeGreaterThan(CONFIG.levelTestDistanceAtr);
    expect(far.stage).toBe("reclaim");
  });

  it("does not accept a wick through resistance (test 20)", () => {
    const level = 101.0;
    const candles = [
      ...confirmedReclaim(level),
      // Trades far above the level intrabar but closes back below it.
      bar(8, 100.9, level + 0.6, 100.8, level - 0.05, 6000),
      bar(9, level - 0.05, level - 0.01, 100.7, level - 0.1, 6000),
    ];
    const result = runReclaimMachine(
      input({ candles, structureLevel: 99.5, priorDayLevel: level }),
      CONFIG
    );
    expect(result.acceptedLevelPrice).toBeNull();
    expect(RECLAIM_STAGE_ORDER[result.stage]).toBeLessThan(RECLAIM_STAGE_ORDER.acceptance);

    // Isolates the rule specifically: a wick clears the buffered price and
    // the NEXT bar would satisfy the retest. Only the requirement that a
    // break be a completed CLOSE stops this becoming an acceptance.
    const wickThenRetest = [
      ...confirmedReclaim(level),
      bar(8, 100.9, level + 0.6, 100.85, level - 0.1, 6000), // wick through, closes below
      bar(9, level - 0.1, level + 0.3, level - 0.1, level + 0.2, 6000),
    ];
    const wicked = runReclaimMachine(
      input({ candles: wickThenRetest, structureLevel: 99.5, priorDayLevel: level }),
      CONFIG
    );
    expect(wicked.acceptedLevelPrice).toBeNull();
    expect(RECLAIM_STAGE_ORDER[wicked.stage]).toBeLessThan(RECLAIM_STAGE_ORDER.acceptance);
  });

  it("accepts on two consecutive buffered completed closes (test 21)", () => {
    const level = 101.0;
    const buffered = level + CONFIG.breakBufferAtr * ATR;
    const candles = [
      ...confirmedReclaim(level),
      bar(8, 100.9, buffered + 0.2, 100.85, buffered + 0.1, 6000),
      bar(9, buffered + 0.1, buffered + 0.3, buffered, buffered + 0.15, 6000),
    ];
    const result = runReclaimMachine(
      input({ candles, structureLevel: 99.5, priorDayLevel: level }),
      CONFIG
    );
    expect(result.acceptedLevelPrice).toBe(level);
    expect(RECLAIM_STAGE_ORDER[result.stage]).toBeGreaterThanOrEqual(
      RECLAIM_STAGE_ORDER.acceptance
    );
  });

  it("accepts on a defined retest inside the window (test 22)", () => {
    const level = 101.0;
    const buffered = level + CONFIG.breakBufferAtr * ATR;
    const candles = [
      ...confirmedReclaim(level),
      bar(8, 100.9, buffered + 0.4, 100.85, buffered + 0.3, 6000), // break
      // Trades back to the buffered price, still closes above the level.
      bar(9, buffered + 0.3, buffered + 0.35, buffered - 0.02, level + 0.12, 6000),
    ];
    const result = runReclaimMachine(
      input({ candles, structureLevel: 99.5, priorDayLevel: level }),
      CONFIG
    );
    expect(RECLAIM_STAGE_ORDER[result.stage]).toBeGreaterThanOrEqual(
      RECLAIM_STAGE_ORDER.acceptance
    );
    // A retested setup is not extended, however far it later runs.
    expect(result.isExtended).toBe(false);
  });

  it("confirms continuation on a three-bar higher low (test 23)", () => {
    // A continuation sequence is long: break, acceptance, a pivot, its
    // confirming bar, then the breakout. That pushes the reset past the
    // default 8-bar recency window, so this case widens the window from
    // configuration — the recency rule itself is covered by test 5.
    const longWindow = { ...CONFIG, resetLookbackBars: 30, newResetMaxAgeBars: 20 };
    const level = 101.0;
    const buffered = level + CONFIG.breakBufferAtr * ATR;
    const candles = [
      ...confirmedReclaim(level),
      bar(8, 100.9, 101.6, 100.85, 101.5, 6000), // break
      bar(9, 101.5, 101.8, 101.4, 101.7, 6000), // second close -> acceptance
      bar(10, 101.7, 101.75, 101.3, 101.45, 6000), // pivot centre (higher low)
      bar(11, 101.45, 101.9, 101.4, 101.85, 6000), // right-hand bar confirms it
      bar(12, 101.85, 102.6, 101.8, 102.5, 6000), // exceeds the post-break peak
    ];
    const result = runReclaimMachine(
      input({ candles, structureLevel: 99.5, priorDayLevel: level }),
      longWindow
    );
    expect(buffered).toBeLessThan(101.5);
    expect(result.stage).toBe("continuation");
  });
});

// ---------------------------------------------------------------------------
// Tests 24, 27 — invalidation and chronological replay
// ---------------------------------------------------------------------------

describe("invalidation and replay", () => {
  it("requires a completed close to invalidate, not a wick (test 24)", () => {
    const base = [...bullishReset(0.8), bar(4, 99.3, 99.9, 99.25, 99.85)];
    const resetLow = 99.2;

    // A wick below the reset extreme that closes back above it.
    const wicked = runReclaimMachine(
      input({ candles: [...base, bar(5, 99.85, 99.9, resetLow - 0.3, 99.8)] }),
      CONFIG
    );
    expect(wicked.stage).not.toBe("invalidated");

    // A completed close below it does invalidate. Asserting only that an
    // invalidation PRICE exists is insufficient — a price is always
    // selected; the stage is what proves the close acted on it.
    const closed = runReclaimMachine(
      input({ candles: [...base, bar(6, 99.85, 99.9, 98.5, 98.6)] }),
      CONFIG
    );
    expect(closed.stage).toBe("invalidated");
    expect(closed.invalidationPrice).not.toBeNull();
  });

  it("always names a real participating invalidation source and price", () => {
    const result = runReclaimMachine(
      input({ candles: [...bullishReset(0.8), bar(4, 99.3, 99.9, 99.25, 99.85)] }),
      CONFIG
    );
    expect(result.invalidationName).not.toBeNull();
    expect(result.invalidationPrice).not.toBeNull();
    expect(Number.isFinite(result.invalidationPrice!)).toBe(true);
  });

  it("takes stageChangedAt from chronological replay, not the latest bar (test 27)", () => {
    const candles = [
      ...bullishReset(0.8),
      bar(4, 99.3, 99.95, 99.25, 99.9), // the bar that establishes exhaustion
      flat(5, 99.9),
      flat(6, 99.9),
    ];
    const result = runReclaimMachine(input({ candles }), CONFIG);
    expect(result.stage).toBe("exhaustion");
    // The stage timestamp is the FIRST candle that satisfied it...
    expect(result.stageChangedAt).toBe(candles[4].time);
    // ...not the newest completed candle.
    expect(result.stageChangedAt).not.toBe(candles[candles.length - 1].time);
  });
});

// ---------------------------------------------------------------------------
// Tests 25, 26 — the bearish mirror and per-machine conflict
// ---------------------------------------------------------------------------

describe("bearish mirror (test 25)", () => {
  it("detects and classifies a bearish reset symmetrically", () => {
    for (const [depth, severity] of [
      [0.45, "shallow"],
      [0.8, "standard"],
      [1.4, "deep"],
    ] as const) {
      const result = runReclaimMachine(
        input({ candles: bearishReset(depth), direction: "bearish" }),
        CONFIG
      );
      expect(result.resetAtr).toBeCloseTo(depth, 6);
      expect(result.resetSeverity).toBe(severity);
    }
  });

  it("mirrors exhaustion onto the low side of the candle's range", () => {
    // A bearish recovery candle must close in the LOWER part of its range.
    const candles = [...bearishReset(0.8), bar(4, 100.7, 100.75, 100.05, 100.1)];
    const result = runReclaimMachine(input({ candles, direction: "bearish" }), CONFIG);
    expect(RECLAIM_STAGE_ORDER[result.stage]).toBeGreaterThanOrEqual(
      RECLAIM_STAGE_ORDER.exhaustion
    );

    // The same shape closing near its HIGH does not qualify bearish.
    const weak = [...bearishReset(0.8), bar(4, 100.1, 100.75, 100.05, 100.7)];
    expect(runReclaimMachine(input({ candles: weak, direction: "bearish" }), CONFIG).stage).toBe(
      "reset"
    );
  });

  it("tracks support below price and measures distance downward", () => {
    const candles = [...bearishReset(0.8), bar(4, 100.7, 100.75, 100.3, 100.35)];
    const result = runReclaimMachine(
      input({ candles, direction: "bearish", premarketLevel: 99.0, priorDayLevel: 100.2 }),
      CONFIG
    );
    // The nearest unbroken support BELOW price wins.
    expect(result.activeLevelPrice).toBe(100.2);
    expect(result.distanceToNextLevelDollars).toBeCloseTo(100.35 - 100.2, 6);
  });

  it("is exactly as hard as the bullish path at the mirrored close location", () => {
    // closeLocation 0.55 passes bullish; its mirror 0.45 passes bearish.
    expect(CONFIG.maxBearishCloseLocation).toBeCloseTo(1 - CONFIG.minBullishCloseLocation, 9);
  });
});

describe("per-machine bullish/bearish conflict (test 26)", () => {
  function stub(overrides: Partial<ReturnType<typeof runReclaimMachine>>) {
    return {
      ...runReclaimMachine(input({ candles: bullishReset(0.8) }), CONFIG),
      ...overrides,
    };
  }

  it("prefers the more advanced stage", () => {
    const bullish = stub({ direction: "bullish", stage: "acceptance" });
    const bearish = stub({ direction: "bearish", stage: "reclaim" });
    expect(selectMachineCandidate(bullish, bearish).winner!.direction).toBe("bullish");
  });

  it("prefers a confirmed reclaim over a forming one at the same stage", () => {
    const bullish = stub({ direction: "bullish", stage: "reclaim", reclaimStatus: "forming" });
    const bearish = stub({ direction: "bearish", stage: "reclaim", reclaimStatus: "confirmed" });
    expect(selectMachineCandidate(bullish, bearish).winner!.direction).toBe("bearish");
  });

  it("then prefers the most recent stage change, then the larger reset", () => {
    const base = { stage: "reclaim" as const, reclaimStatus: "forming" as const };
    const newer = selectMachineCandidate(
      stub({ ...base, direction: "bullish", stageChangedAt: 100 }),
      stub({ ...base, direction: "bearish", stageChangedAt: 200 })
    );
    expect(newer.winner!.direction).toBe("bearish");

    const deeper = selectMachineCandidate(
      stub({ ...base, direction: "bullish", stageChangedAt: 100, resetAtr: 1.2 }),
      stub({ ...base, direction: "bearish", stageChangedAt: 100, resetAtr: 0.5 })
    );
    expect(deeper.winner!.direction).toBe("bullish");
  });

  it("returns unavailable with a reason when everything ties exactly", () => {
    const base = {
      stage: "reclaim" as const,
      reclaimStatus: "forming" as const,
      stageChangedAt: 100,
      resetAtr: 0.8,
    };
    const tie = selectMachineCandidate(
      stub({ ...base, direction: "bullish" }),
      stub({ ...base, direction: "bearish" })
    );
    expect(tie.winner).toBeNull();
    expect(tie.ambiguous).toBe(true);
    expect(tie.reason).toBe("Ambiguous opposing setup");
  });
});

// ---------------------------------------------------------------------------
// Purity and unavailability
// ---------------------------------------------------------------------------

describe("purity", () => {
  it("never mutates the candle array or its candles", () => {
    const candles = bullishReset(0.8).map((c) => Object.freeze(c));
    const frozen = Object.freeze(candles);
    expect(() =>
      runReclaimMachine(input({ candles: frozen, structureLevel: 99.5 }), CONFIG)
    ).not.toThrow();
    expect(frozen).toHaveLength(4);
  });

  it("produces identical output for identical input", () => {
    const candles = bullishReset(0.8);
    const a = runReclaimMachine(input({ candles, structureLevel: 99.5 }), CONFIG);
    const b = runReclaimMachine(input({ candles, structureLevel: 99.5 }), CONFIG);
    expect(a).toEqual(b);
  });

  it("reports unavailable rather than guessing when ATR is unusable", () => {
    for (const atr of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = runReclaimMachine(input({ candles: bullishReset(0.8), atr }), CONFIG);
      expect(result.stage).toBe("unavailable");
      expect(result.unavailableReason).toBe("invalid_atr");
      // No fabricated numbers travel with an unavailable read.
      expect(result.resetDollars).toBeNull();
      expect(result.resetAtr).toBeNull();
    }
  });

  it("reports unavailable with too few candles", () => {
    const result = runReclaimMachine(input({ candles: [flat(0, 100)] }), CONFIG);
    expect(result.stage).toBe("unavailable");
    expect(result.unavailableReason).toBe("insufficient_candles");
  });

  it("refuses to evaluate under an invalid configuration (spec test 72)", () => {
    expect(() =>
      runReclaimMachine(input({ candles: bullishReset(0.8) }), {
        ...CONFIG,
        minResetAtr: 0,
      })
    ).toThrow(/Invalid reclaimContinuation config/);
  });

  it("carries the timeframe through without changing the calculation", () => {
    const candles = bullishReset(0.8);
    const fiveMinute = runReclaimMachine(input({ candles, timeframe: "five_minute" }), CONFIG);
    const oneMinute = runReclaimMachine(input({ candles, timeframe: "one_minute" }), CONFIG);

    expect(oneMinute.timeframe).toBe("one_minute");
    expect({ ...oneMinute, timeframe: "five_minute" as const }).toEqual(fiveMinute);
  });
});
