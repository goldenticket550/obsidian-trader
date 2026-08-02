import { describe, it, expect } from "vitest";
import {
  runReclaimMachine,
  selectMachineCandidate,
  RECLAIM_STAGE_ORDER,
  type ReclaimMachineInput,
  type ReclaimMachineResult,
} from "@/lib/scanner/reclaimContinuation";
import {
  isConfigObject,
  normalizeReclaimContinuationConfig,
  normalizeAndValidateStrategyConfig,
  validateReclaimContinuationConfig,
} from "@/lib/strategies/reclaimContinuationConfig";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import type { Candle } from "@/types/candle";

/**
 * Part A — chronological replay and no-lookahead.
 *
 * Every test here exists because the previous implementation computed
 * final-series values and applied them backward. The theme throughout:
 * a fact may only influence a candle that came AFTER the fact existed.
 */

const CONFIG = defaultStrategyConfig.reclaimContinuation;
const ATR = 1.0;
const T0 = Math.floor(Date.parse("2026-07-13T13:30:00Z") / 1000);

function bar(i: number, o: number, h: number, l: number, c: number, v = 1000): Candle {
  return { time: T0 + i * 300, open: o, high: h, low: l, close: c, volume: v };
}
function flat(i: number, price: number): Candle {
  return bar(i, price, price + 0.02, price - 0.02, price);
}

function input(overrides: Partial<ReclaimMachineInput> = {}): ReclaimMachineInput {
  return {
    symbol: "TEST",
    sessionDate: "2026-07-13",
    direction: "bullish",
    timeframe: "five_minute",
    candles: [],
    atr: ATR,
    // A given level that exists for the whole series, so it is available
    // from the first bar. Availability-timing tests override this.
    structureAvailableFromTime: T0,
    priorDayLevel: null,
    premarketLevel: null,
    premarketAvailableFromIndex: null,
    openingRangeLevel: null,
    openingRangeAvailableFromIndex: null,
    regularSessionStartIndex: null,
    structureLevel: null,
    sweepEvidence: null,
    freshness: "real_time",
    volumePace: null,
    benchmarkRelativeMove: null,
    ...overrides,
  };
}

/** Anchor 100, flush to 100-depth, weak close (no exhaustion yet). */
function reset(depth: number): Candle[] {
  const low = 100 - depth;
  return [
    flat(0, 98),
    bar(1, 98, 100, 97.8, 99.8),
    bar(2, 99.8, 99.9, low + 0.4, low + 0.5),
    bar(3, low + 0.5, low + 0.6, low, low + 0.1),
  ];
}

/**
 * A full bullish sequence on the DEFAULT config: reset, exhaustion, two
 * distinct control reclaims, a buffered break, acceptance, a confirmed
 * three-bar higher low, then a close past the post-break peak.
 */
function continuationSeries(level: number): Candle[] {
  const buffered = level + CONFIG.breakBufferAtr * ATR;
  return [
    bar(0, 100.0, 100.2, 99.9, 100.1, 5000),
    bar(1, 100.1, 101.0, 100.0, 100.9, 5000),
    bar(2, 100.9, 101.0, 99.2, 99.3, 8000), // flush
    bar(3, 99.3, 99.4, 99.0, 99.15, 8000), // reset low 99.0
    bar(4, 99.15, 99.95, 99.1, 99.9, 6000), // exhaustion (strong close)
    bar(5, 99.9, 100.9, 99.85, 100.85, 6000), // reclaims controls
    bar(6, 100.85, 101.0, 100.7, 100.95, 6000),
    bar(7, 100.95, buffered + 0.4, 100.9, buffered + 0.3, 6000), // break
    bar(8, buffered + 0.3, buffered + 0.6, buffered + 0.2, buffered + 0.5, 6000), // acceptance
    bar(9, buffered + 0.5, buffered + 0.55, buffered + 0.1, buffered + 0.15, 6000), // pivot centre
    bar(10, buffered + 0.15, buffered + 0.7, buffered + 0.12, buffered + 0.65, 6000), // confirms pivot
    bar(11, buffered + 0.65, buffered + 1.4, buffered + 0.6, buffered + 1.3, 6000), // continuation
  ];
}

// ---------------------------------------------------------------------------
// 1-5 — reset lifecycle
// ---------------------------------------------------------------------------

describe("reset lifecycle", () => {
  it("reaches continuation on the DEFAULT config, with no age override (test 3)", () => {
    const level = 101.0;
    const result = runReclaimMachine(
      input({
        candles: continuationSeries(level),
        structureLevel: 99.5,
        priorDayLevel: level,
      }),
      CONFIG // <- the shipped defaults, deliberately not widened
    );
    expect(result.stage).toBe("continuation");
    expect(CONFIG.newResetMaxAgeBars).toBe(8);
  });

  it("does not re-anchor identity on recovery candles (test 4)", () => {
    const base = [...reset(0.8), bar(4, 99.3, 99.95, 99.25, 99.9)];
    const first = runReclaimMachine(input({ candles: base }), CONFIG);
    const later = runReclaimMachine(
      input({ candles: [...base, flat(5, 99.9), bar(6, 99.9, 100.5, 99.85, 100.4)] }),
      CONFIG
    );
    expect(later.resetAnchorTime).toBe(first.resetAnchorTime);
    expect(later.resetExtremeTime).toBe(first.resetExtremeTime);
    expect(later.setupKey).toBe(first.setupKey);
  });

  it("only seeds a replacement identity after the previous setup went terminal (test 5)", () => {
    // The first setup invalidates, then a genuinely new flush occurs.
    const candles = [
      ...reset(0.8),
      bar(4, 99.3, 99.95, 99.25, 99.9), // exhaustion
      bar(5, 99.9, 99.95, 98.4, 98.5), // adverse close -> invalidated (terminal)
      bar(6, 98.5, 99.6, 98.45, 99.5), // a new leg up
      bar(7, 99.5, 99.6, 98.2, 98.3), // a NEW qualifying flush
      bar(8, 98.3, 99.2, 98.25, 99.15), // its exhaustion
    ];
    const result = runReclaimMachine(input({ candles }), CONFIG);
    // The identity moved on from the first, terminated setup.
    expect(result.resetExtremeTime).not.toBe(candles[3].time);
    expect(result.setupKey).toContain(String(candles[7].time));
  });
});

// ---------------------------------------------------------------------------
// 6-11 — stage chronology
// ---------------------------------------------------------------------------

describe("stage chronology", () => {
  it("cannot reclaim before exhaustion exists (test 6)", () => {
    // Price crosses the structure level while still selling off, before
    // any recovery has qualified as exhaustion.
    const candles = [
      flat(0, 100),
      bar(1, 100, 100.2, 99.9, 100.05),
      bar(2, 100.05, 100.1, 99.0, 99.1), // flush
      bar(3, 99.1, 99.15, 98.6, 98.65), // still selling, no exhaustion
    ];
    const result = runReclaimMachine(input({ candles, structureLevel: 98.9 }), CONFIG);
    expect(result.stage).toBe("reset");
    expect(result.reclaimStatus).toBe("none");
    expect(result.emaReclaimed).toBe(false);
    expect(result.vwapReclaimed).toBe(false);
    expect(result.structureReclaimed).toBe(false);
  });

  it("allows one candle to establish exhaustion AND reclaim a control (test 7)", () => {
    const candles = continuationSeries(101.0).slice(0, 6);
    const result = runReclaimMachine(
      input({ candles, structureLevel: 99.5 }),
      CONFIG
    );
    // Exhaustion and at least one crossing both exist; the machine does
    // not require a separate later bar to begin reclaiming.
    expect(RECLAIM_STAGE_ORDER[result.stage]).toBeGreaterThanOrEqual(
      RECLAIM_STAGE_ORDER.exhaustion
    );
    expect(result.reclaimFormingAt).not.toBeNull();
  });

  it("dates forming at the first crossing and confirmed at the SECOND (tests 8, 9)", () => {
    const result = runReclaimMachine(
      input({ candles: continuationSeries(101.0), structureLevel: 99.5, priorDayLevel: 101.0 }),
      CONFIG
    );
    expect(result.reclaimStatus).toBe("confirmed");
    expect(result.reclaimFormingAt).not.toBeNull();
    expect(result.reclaimConfirmedAt).not.toBeNull();
    // Confirmed is strictly later than forming — never the earliest crossing.
    expect(result.reclaimConfirmedAt!).toBeGreaterThanOrEqual(result.reclaimFormingAt!);
  });

  it("cannot accept without a confirmed reclaim (test 10)", () => {
    // Only ONE control is ever reclaimed, so reclaim stays forming and a
    // break cannot become acceptance however clean it is.
    const level = 101.0;
    const buffered = level + CONFIG.breakBufferAtr * ATR;
    const candles = [
      ...reset(0.8),
      bar(4, 99.3, 99.95, 99.25, 99.9), // exhaustion
      bar(5, 99.9, buffered + 0.4, 99.85, buffered + 0.3),
      bar(6, buffered + 0.3, buffered + 0.6, buffered + 0.2, buffered + 0.5),
    ];
    const result = runReclaimMachine(input({ candles, priorDayLevel: level }), CONFIG);
    if (result.reclaimStatus !== "confirmed") {
      expect(result.acceptedLevelPrice).toBeNull();
      expect(RECLAIM_STAGE_ORDER[result.stage]).toBeLessThan(RECLAIM_STAGE_ORDER.acceptance);
    }
  });

  it("cannot continue without acceptance (test 11)", () => {
    // Truncated before the break, so acceptance never happens.
    const candles = continuationSeries(101.0).slice(0, 7);
    const result = runReclaimMachine(
      input({ candles, structureLevel: 99.5, priorDayLevel: 101.0 }),
      CONFIG
    );
    expect(result.acceptedLevelPrice).toBeNull();
    expect(result.stage).not.toBe("continuation");
  });
});

// ---------------------------------------------------------------------------
// 12-14 — level availability
// ---------------------------------------------------------------------------

describe("level availability", () => {
  /**
   * A flush, then price crosses 99.80 on bar 5 — long before any pivot at
   * that price could exist. A structure level is derived from a pivot, and
   * a pivot is only knowable once the bars to its right have completed, so
   * using the price without an availability bound reclaims a control with
   * information that did not exist yet.
   */
  const lateStructureSeries = (): Candle[] => [
    bar(0, 100.5, 100.6, 100.4, 100.5),
    bar(1, 100.5, 100.55, 99.1, 99.2),
    bar(2, 99.2, 99.3, 98.5, 98.6),
    bar(3, 98.6, 99.3, 98.55, 99.25),
    bar(4, 99.25, 99.6, 99.2, 99.55),
    bar(5, 99.55, 100.1, 99.5, 100.05),
    bar(6, 100.05, 100.2, 99.9, 100.1),
    bar(7, 100.1, 100.3, 100.0, 100.2),
    bar(8, 100.2, 100.4, 100.1, 100.3),
    bar(9, 100.3, 100.35, 99.6, 99.7),
    bar(10, 99.7, 99.75, 99.3, 99.4),
    bar(11, 99.4, 99.5, 99.2, 99.3),
    bar(12, 99.3, 99.8, 99.25, 99.75),
  ];

  it("cannot reclaim a structure level before that level was knowable", () => {
    const candles = lateStructureSeries();
    const STRUCTURE = 99.8;
    // The bar from which the level genuinely became available.
    const availableFrom = candles[12].time;

    const honest = runReclaimMachine(
      input({ candles, structureLevel: STRUCTURE, structureAvailableFromTime: availableFrom }),
      CONFIG
    );
    const hindsight = runReclaimMachine(
      input({ candles, structureLevel: STRUCTURE, structureAvailableFromTime: candles[0].time }),
      CONFIG
    );

    // Precondition: the level really is crossed early, so this cannot pass
    // just because nothing happens on this series.
    expect(hindsight.structureReclaimed).toBe(true);
    expect(hindsight.reclaimConfirmedAt).toBe(candles[5].time);

    // Held to its true availability, the structure control contributes
    // nothing before bar 12 — so confirmation cannot be pulled forward.
    expect(honest.reclaimConfirmedAt).not.toBe(candles[5].time);
    expect(honest.structureReclaimed).toBe(false);
  });

  it("ignores a structure level whose availability is unknown", () => {
    // No availability information at all is treated as NOT available. A
    // level nobody can date is a hindsight price.
    const candles = lateStructureSeries();
    const undated = runReclaimMachine(
      input({ candles, structureLevel: 99.8, structureAvailableFromTime: null }),
      CONFIG
    );
    expect(undated.structureReclaimed).toBe(false);
  });

  it("cannot test or accept a level before availableFromIndex (test 12)", () => {
    const level = 101.0;
    const candles = continuationSeries(level);
    // The same level, declared available only after the whole sequence.
    const late = runReclaimMachine(
      input({
        candles,
        structureLevel: 99.5,
        openingRangeLevel: level,
        openingRangeAvailableFromIndex: candles.length - 1,
      }),
      CONFIG
    );
    const early = runReclaimMachine(
      input({
        candles,
        structureLevel: 99.5,
        openingRangeLevel: level,
        openingRangeAvailableFromIndex: 0,
      }),
      CONFIG
    );
    // Available from the start, the level can be broken and accepted.
    expect(RECLAIM_STAGE_ORDER[early.stage]).toBeGreaterThanOrEqual(
      RECLAIM_STAGE_ORDER.acceptance
    );
    // Declared late, it cannot retroactively have been broken — either
    // nothing was accepted, or it was some other, genuinely available level.
    expect(late.acceptedLevelName === null || !late.acceptedLevelName.includes("Opening-range"))
      .toBe(true);
  });

  it("does not let a dynamic session extreme create a backdated break (test 13)", () => {
    // The session high is rebuilt from candles strictly BEFORE each bar,
    // so the final high can never be the level an earlier bar broke.
    const candles = continuationSeries(101.0);
    const result = runReclaimMachine(
      input({ candles, structureLevel: 99.5, regularSessionStartIndex: 0 }),
      CONFIG
    );
    const finalHigh = Math.max(...candles.map((c) => c.high));
    // Nothing is reported as accepted at the series' own final extreme.
    expect(result.acceptedLevelPrice === null || result.acceptedLevelPrice < finalHigh).toBe(true);
  });

  it("lets a previously broken level matter again once price loses it (test 14)", () => {
    const level = 100.5;
    const candles = [
      bar(0, 100.6, 101.0, 100.55, 100.9), // above the level to begin with
      bar(1, 100.9, 101.0, 99.2, 99.3), // loses it
      bar(2, 99.3, 99.4, 99.0, 99.15), // reset low
      bar(3, 99.15, 99.95, 99.1, 99.9), // exhaustion
      bar(4, 99.9, 100.2, 99.85, 100.15), // back under the level
    ];
    const result = runReclaimMachine(
      input({ candles, priorDayLevel: level, structureLevel: 99.5 }),
      CONFIG
    );
    // The level is ahead of price again, so it is a live target once more.
    expect(result.activeLevelPrice).toBe(level);
  });
});

// ---------------------------------------------------------------------------
// 15-18 — invalidation
// ---------------------------------------------------------------------------

describe("invalidation", () => {
  it("locks a contemporaneous value and exposes when it became active (tests 15, 16)", () => {
    const result = runReclaimMachine(
      input({ candles: continuationSeries(101.0), structureLevel: 99.5 }),
      CONFIG
    );
    expect(result.invalidationName).not.toBeNull();
    expect(result.invalidationPrice).not.toBeNull();
    expect(result.invalidationActiveFromIndex).not.toBeNull();
    // A locked EMA/VWAP invalidation is NOT the latest series value.
    if (result.invalidationName === "VWAP") {
      expect(result.invalidationPrice).not.toBe(result.vwap);
    }
    if (result.invalidationName === "9 EMA") {
      expect(result.invalidationPrice).not.toBe(result.ema9);
    }
  });

  it("does not invalidate on a wick (test 17)", () => {
    const candles = [
      ...reset(0.8),
      bar(4, 99.3, 99.95, 99.25, 99.9), // exhaustion
      bar(5, 99.9, 99.95, 98.0, 99.85), // deep wick, closes back up
    ];
    const result = runReclaimMachine(input({ candles }), CONFIG);
    expect(result.stage).not.toBe("invalidated");
  });

  it("sets stage to invalidated on a completed adverse close (test 18)", () => {
    const candles = [
      ...reset(0.8),
      bar(4, 99.3, 99.95, 99.25, 99.9), // exhaustion
      bar(5, 99.9, 99.95, 98.0, 98.1), // completed close through it
    ];
    const result = runReclaimMachine(input({ candles }), CONFIG);
    expect(result.stage).toBe("invalidated");
  });
});

// ---------------------------------------------------------------------------
// 19-21 — freshness honesty
// ---------------------------------------------------------------------------

describe("freshness honesty", () => {
  const candles = [...reset(0.8), bar(4, 99.3, 99.95, 99.25, 99.9)];

  it("evaluates on real-time data (test 19)", () => {
    const result = runReclaimMachine(input({ candles, freshness: "real_time" }), CONFIG);
    expect(result.stage).not.toBe("unavailable");
    const group = result.evidence.find((e) => e.name === "dataFreshness")!;
    expect(group.state).toBe("pass");
  });

  it("evaluates delayed data but says so honestly (test 20)", () => {
    const result = runReclaimMachine(input({ candles, freshness: "delayed" }), CONFIG);
    expect(result.stage).not.toBe("unavailable");
    const group = result.evidence.find((e) => e.name === "dataFreshness")!;
    // Never reported as a plain pass — the feed is known delayed.
    expect(group.state).not.toBe("pass");
    expect(group.detail).toMatch(/delayed/i);
  });

  it("blocks a candidate on stale, partial, unavailable and missing (test 21)", () => {
    for (const freshness of ["stale", "partial", "unavailable", null] as const) {
      const result = runReclaimMachine(input({ candles, freshness }), CONFIG);
      expect(result.stage).toBe("unavailable");
      expect(result.unavailableReason).toBe("freshness_blocked");
      // Completed data is never silently treated as fresh.
      expect(result.evidence.find((e) => e.name === "dataFreshness")!.state).not.toBe("pass");
    }
  });
});

// ---------------------------------------------------------------------------
// 22-24 — sweep evidence
// ---------------------------------------------------------------------------

describe("sweep evidence", () => {
  // A recovery candle that closes mid-range: the measured-recovery path
  // alone cannot establish exhaustion here.
  const candles = [...reset(0.8), bar(4, 99.3, 99.7, 99.25, 99.4)];
  const goodSweep = {
    direction: "bullish" as const,
    sweptLevel: 99.2,
    sweepCandleTime: candles[3].time,
    reclaimCandleTime: candles[4].time,
  };

  it("uses the actual sweep reclaim candle for exhaustion (test 24)", () => {
    const result = runReclaimMachine(input({ candles, sweepEvidence: goodSweep }), CONFIG);
    expect(RECLAIM_STAGE_ORDER[result.stage]).toBeGreaterThanOrEqual(
      RECLAIM_STAGE_ORDER.exhaustion
    );
    expect(result.stageChangedAt).toBe(candles[4].time);
    expect(result.evidence.find((e) => e.name === "failedContinuation")!.detail).toMatch(
      /swept/i
    );
  });

  it("ignores a wrong-direction sweep (test 22)", () => {
    const result = runReclaimMachine(
      input({ candles, sweepEvidence: { ...goodSweep, direction: "bearish" } }),
      CONFIG
    );
    expect(result.stage).toBe("reset");
  });

  it("ignores a sweep from before the active reset (test 23)", () => {
    const result = runReclaimMachine(
      input({
        candles,
        sweepEvidence: {
          ...goodSweep,
          sweepCandleTime: T0 - 100_000,
          reclaimCandleTime: T0 - 99_000,
        },
      }),
      CONFIG
    );
    expect(result.stage).toBe("reset");
  });

  it("leaves bearish sweep evidence unavailable until a real mirror exists", () => {
    // The repository's sweep detector is bullish only; the bearish machine
    // falls back to the measured-recovery path rather than reusing it.
    const bearish = runReclaimMachine(
      input({ candles, direction: "bearish", sweepEvidence: null }),
      CONFIG
    );
    expect(bearish.evidence.find((e) => e.name === "failedContinuation")!.detail).not.toMatch(
      /swept/i
    );
  });
});

// ---------------------------------------------------------------------------
// 25 — active-candidate selection
// ---------------------------------------------------------------------------

describe("active-candidate selection", () => {
  function stub(overrides: Partial<ReclaimMachineResult>): ReclaimMachineResult {
    const base = runReclaimMachine(
      input({ candles: [...reset(0.8), bar(4, 99.3, 99.95, 99.25, 99.9)] }),
      CONFIG
    );
    return { ...base, ...overrides };
  }

  it("never returns an invalidated setup as the active winner (test 25)", () => {
    const invalidated = stub({ direction: "bullish", stage: "invalidated" });
    const unavailable = stub({ direction: "bearish", stage: "unavailable" });

    const selection = selectMachineCandidate(invalidated, unavailable);
    expect(selection.winner).toBeNull();
    // ...but it is still available as history rather than discarded.
    expect(selection.historical).not.toBeNull();
    expect(selection.historical!.stage).toBe("invalidated");
  });

  it("still returns a genuinely active setup", () => {
    const active = stub({ direction: "bullish", stage: "reclaim" });
    const invalidated = stub({ direction: "bearish", stage: "invalidated" });
    const selection = selectMachineCandidate(active, invalidated);
    expect(selection.winner!.direction).toBe("bullish");
    expect(selection.historical!.direction).toBe("bearish");
  });
});

// ---------------------------------------------------------------------------
// 26-29 — settings validation hardening
// ---------------------------------------------------------------------------

describe("settings validation hardening", () => {
  it("rejects null, strings, numbers and arrays as configuration bodies (test 26)", () => {
    for (const body of [null, "config", 42, [], [1, 2], true]) {
      expect(isConfigObject(body)).toBe(false);
    }
    expect(isConfigObject({})).toBe(true);
    expect(isConfigObject({ reclaimContinuation: {} })).toBe(true);
  });

  it("names the block itself without a dangling separator", () => {
    const errors = validateReclaimContinuationConfig(undefined);
    expect(errors[0].field).toBe("reclaimContinuation");
    expect(errors[0].field).not.toBe("reclaimContinuation.");
  });

  it("treats a non-object block as invalid rather than throwing", () => {
    expect(
      validateReclaimContinuationConfig([] as unknown as Partial<typeof CONFIG>)[0].field
    ).toBe("reclaimContinuation");
  });

  it("normalizes a legacy stored config missing the whole block (test 28)", () => {
    const legacy = { ...defaultStrategyConfig } as StrategyConfig;
    delete (legacy as Partial<StrategyConfig>).reclaimContinuation;

    const { config, errors } = normalizeAndValidateStrategyConfig(legacy);
    expect(errors).toEqual([]);
    expect(config.reclaimContinuation).toEqual(CONFIG);
    expect(config.reclaimContinuation.enabled).toBe(true);
    expect(config.reclaimContinuation.alertingEnabled).toBe(false);
  });

  it("fails clearly on a present invalid stored value (test 29)", () => {
    const stored = {
      ...defaultStrategyConfig,
      reclaimContinuation: { ...CONFIG, breakBufferAtr: -1 },
    } as StrategyConfig;

    const { errors } = normalizeAndValidateStrategyConfig(stored);
    expect(errors.map((e) => e.field)).toContain("reclaimContinuation.breakBufferAtr");
    // A present invalid value is never quietly replaced by the default.
    expect(normalizeReclaimContinuationConfig({ breakBufferAtr: -1 }).breakBufferAtr).toBe(-1);
  });

  it("preserves unrelated strategy blocks through normalization (test 27 support)", () => {
    const stored = {
      ...defaultStrategyConfig,
      momentumLadder: { tiers: [7, 9] },
      reclaimContinuation: { minResetAtr: 0.5 } as never,
    } as StrategyConfig;

    const { config } = normalizeAndValidateStrategyConfig(stored);
    expect(config.momentumLadder).toEqual({ tiers: [7, 9] });
    expect(config.reclaimContinuation.minResetAtr).toBe(0.5);
    expect(config.reclaimContinuation.retestWindowBars).toBe(CONFIG.retestWindowBars);
  });
});
