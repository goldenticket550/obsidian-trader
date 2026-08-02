import { describe, it, expect } from "vitest";
import {
  runReclaimForSymbol,
  computeAlignment,
  tierForStage,
  rankReclaimCandidates,
  compareReclaimCandidates,
  levelForDirection,
  MIXED_TIMEFRAMES_LABEL,
  RECLAIM_TIER_ORDER,
  type ReclaimRunnerInput,
  type ReclaimSymbolResult,
  type ReclaimTimeframeSeries,
} from "@/lib/scanner/reclaimRunner";
import { runReclaimMachine, type ReclaimMachineResult } from "@/lib/scanner/reclaimContinuation";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import type { Candle } from "@/types/candle";

/**
 * Part B — the two-timeframe runner.
 *
 * The five-minute machine is the system of record; the one-minute machine
 * is a scout that may surface a candidate earlier but is capped at
 * Monitor. Everything below exists to keep one-minute noise out of
 * actionable calls.
 */

const CONFIG = defaultStrategyConfig.reclaimContinuation;
const ATR = 1.0;
const T0 = Math.floor(Date.parse("2026-07-13T13:30:00Z") / 1000);
const LEVEL = 101.0;
/** Deliberately different from LEVEL so a mixed-up side is visible. */
const LEVEL_LOW = 98.5;

function bar(i: number, o: number, h: number, l: number, c: number, step = 300): Candle {
  return { time: T0 + i * step, open: o, high: h, low: l, close: c, volume: 5000 };
}

/** Reset -> exhaustion -> two control reclaims -> break -> acceptance -> continuation. */
function fullSequence(step = 300): Candle[] {
  const buffered = LEVEL + CONFIG.breakBufferAtr * ATR;
  return [
    bar(0, 100.0, 100.2, 99.9, 100.1, step),
    bar(1, 100.1, 101.0, 100.0, 100.9, step),
    bar(2, 100.9, 101.0, 99.2, 99.3, step),
    bar(3, 99.3, 99.4, 99.0, 99.15, step),
    bar(4, 99.15, 99.95, 99.1, 99.9, step),
    bar(5, 99.9, 100.9, 99.85, 100.85, step),
    bar(6, 100.85, 101.0, 100.7, 100.95, step),
    bar(7, 100.95, buffered + 0.4, 100.9, buffered + 0.3, step),
    bar(8, buffered + 0.3, buffered + 0.6, buffered + 0.2, buffered + 0.5, step),
    bar(9, buffered + 0.5, buffered + 0.55, buffered + 0.1, buffered + 0.15, step),
    bar(10, buffered + 0.15, buffered + 0.7, buffered + 0.12, buffered + 0.65, step),
    bar(11, buffered + 0.65, buffered + 1.4, buffered + 0.6, buffered + 1.3, step),
  ];
}

/** A short series that stops at exhaustion. */
function exhaustionOnly(step = 300): Candle[] {
  return fullSequence(step).slice(0, 5);
}

function series(candles: Candle[]): ReclaimTimeframeSeries {
  return {
    candles,
    regularSessionStartIndex: null,
    premarketAvailableFromIndex: null,
    openingRangeAvailableFromIndex: null,
  };
}

function runnerInput(overrides: Partial<ReclaimRunnerInput> = {}): ReclaimRunnerInput {
  return {
    symbol: "TEST",
    sessionDate: "2026-07-13",
    fiveMinute: series(fullSequence()),
    oneMinute: series(fullSequence(60)),
    atr: ATR,
    // Directional pairs: the bullish machine takes `high`, bearish `low`.
    priorDayLevel: { high: LEVEL, low: LEVEL_LOW },
    premarketLevel: null,
    openingRangeLevel: null,
    structureLevel: { high: 99.5, low: 99.5 },
    structureAvailableFromTime: T0,
    sweepEvidence: null,
    freshness: "real_time",
    volumePace: null,
    benchmarkRelativeMove: null,
    ...overrides,
  };
}

function run(overrides: Partial<ReclaimRunnerInput> = {}) {
  return runReclaimForSymbol(runnerInput(overrides), CONFIG);
}

// ---------------------------------------------------------------------------
// 41, 42 — tier by timeframe
// ---------------------------------------------------------------------------

describe("tier by timeframe", () => {
  it("caps a one-minute-only acceptance at Monitor (spec test 41)", () => {
    // The scout is far ahead; the authoritative machine has only exhausted.
    const result = run({
      fiveMinute: series(exhaustionOnly()),
      oneMinute: series(fullSequence(60)),
    });

    expect(result.oneMinuteStage).toBe("continuation");
    // The authoritative machine has not reached an actionable stage.
    expect(["exhaustion", "reclaim"]).toContain(result.stage);
    expect(result.fiveMinuteTier).not.toBe("review_now");
    // The one-minute read would justify Review Now on its own...
    expect(result.oneMinuteUncappedTier).toBe("review_now");
    // ...and is held to Monitor, because only the 5m machine may be actionable.
    expect(result.alertTier).toBe("monitor");
    expect(result.cappedByTimeframe).toBe(true);
    expect(RECLAIM_TIER_ORDER[result.alertTier]).toBeLessThan(
      RECLAIM_TIER_ORDER.review_now
    );
  });

  it("lets a five-minute-confirmed acceptance reach Review Now (spec test 42)", () => {
    const result = run({
      fiveMinute: series(fullSequence()),
      oneMinute: series(fullSequence(60)),
    });
    expect(result.stage).toBe("continuation");
    expect(result.fiveMinuteTier).toBe("review_now");
    // Review Now comes from the five-minute machine on its own merit —
    // the one-minute read is still capped, it is simply not needed.
    expect(result.alertTier).toBe("review_now");
    expect(result.reviewBlockedByAlignment).toBe(false);
  });

  it("never rates a one-minute machine above Monitor, whatever it shows", () => {
    for (const stage of ["level_test", "acceptance", "continuation"] as const) {
      const stub = { stage, reclaimStatus: "confirmed" } as ReclaimMachineResult;
      expect(tierForStage(stub, "one_minute")).toBe("monitor");
      // The same stage from the five-minute machine is actionable.
      expect(tierForStage(stub, "five_minute")).toBe("review_now");
    }
  });

  it("treats an inactive machine as no tier at all", () => {
    for (const stage of ["unavailable", "invalidated"] as const) {
      const stub = { stage, reclaimStatus: "none" } as ReclaimMachineResult;
      expect(tierForStage(stub, "five_minute")).toBe("none");
      expect(tierForStage(stub, "one_minute")).toBe("none");
    }
    expect(tierForStage(null, "five_minute")).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Directional level selection
// ---------------------------------------------------------------------------

describe("directional level selection", () => {
  it("hands the bullish machine the high and the bearish machine the low", () => {
    for (const direction of ["bullish", "bearish"] as const) {
      const pair = { high: 111, low: 99 };
      expect(levelForDirection(pair, direction)).toBe(direction === "bullish" ? 111 : 99);
    }
  });

  it("treats a missing pair, or a missing side, as unavailable", () => {
    expect(levelForDirection(null, "bullish")).toBeNull();
    expect(levelForDirection(null, "bearish")).toBeNull();
    // One side known and the other not: the unknown side stays null
    // rather than borrowing the side that happens to exist.
    expect(levelForDirection({ high: 111, low: null }, "bearish")).toBeNull();
    expect(levelForDirection({ high: null, low: 99 }, "bullish")).toBeNull();
  });

  it("never lets a level of zero be mistaken for unavailable", () => {
    // Zero is a real (if unusual) price and must survive selection.
    expect(levelForDirection({ high: 0, low: 0 }, "bullish")).toBe(0);
    expect(levelForDirection({ high: 0, low: 0 }, "bearish")).toBe(0);
  });

  it("feeds the bearish machine the low, end to end", () => {
    // Mirror the series so the five-minute machine resolves bearish, then
    // check which side of the prior-day pair actually reached the detector.
    const bearishSeries = fullSequence().map((c) => ({
      ...c,
      open: 200 - c.open,
      high: 200 - c.low,
      low: 200 - c.high,
      close: 200 - c.close,
    }));

    const directBearish = (priorDayLevel: number) =>
      runReclaimMachine(
        {
          symbol: "TEST",
          sessionDate: "2026-07-13",
          direction: "bearish",
          timeframe: "five_minute",
          candles: bearishSeries,
          atr: ATR,
          priorDayLevel,
          premarketLevel: null,
          premarketAvailableFromIndex: null,
          openingRangeLevel: null,
          openingRangeAvailableFromIndex: null,
          regularSessionStartIndex: null,
          structureLevel: 99.5,
          structureAvailableFromTime: T0,
          sweepEvidence: null,
          freshness: "real_time",
          volumePace: null,
          benchmarkRelativeMove: null,
        },
        CONFIG
      );

    const fedLow = directBearish(LEVEL_LOW);
    const fedHigh = directBearish(LEVEL);

    // Precondition: the two sides genuinely produce different reads, so
    // matching one of them cannot pass vacuously.
    expect(fedLow.acceptedLevelPrice).not.toBe(fedHigh.acceptedLevelPrice);

    const result = run({
      fiveMinute: series(bearishSeries),
      oneMinute: null,
      priorDayLevel: { high: LEVEL, low: LEVEL_LOW },
    });

    expect(result.fiveMinute!.direction).toBe("bearish");
    expect(result.fiveMinute!.acceptedLevelPrice).toBe(fedLow.acceptedLevelPrice);
    expect(result.fiveMinute!.acceptedLevelPrice).not.toBe(fedHigh.acceptedLevelPrice);
  });

  it("sends the bullish machine the structure high and the bearish machine the low", () => {
    const structure = { high: 103.25, low: 97.75 };
    expect(levelForDirection(structure, "bullish")).toBe(structure.high);
    expect(levelForDirection(structure, "bearish")).toBe(structure.low);
  });

  it("leaves the bearish structure side null when only a resistance level exists", () => {
    // The repo's structure-shift detector yields a swing HIGH only. The
    // bearish machine must get nothing rather than the high relabelled.
    const resistanceOnly = { high: 103.25, low: null };
    expect(levelForDirection(resistanceOnly, "bullish")).toBe(103.25);
    expect(levelForDirection(resistanceOnly, "bearish")).toBeNull();
  });

  it("keeps sweep evidence untouched — it is already self-directional", () => {
    // The detector compares sweep.direction to the machine direction, so
    // the runner must not pick a side for it, rewrite its direction, or
    // mutate it. Frozen so any in-place edit throws.
    const sweep = Object.freeze({
      direction: "bullish" as const,
      sweptLevel: 99,
      sweepCandleTime: T0,
      reclaimCandleTime: T0 + 300,
    });
    const result = run({ oneMinute: null, sweepEvidence: sweep });
    expect(result.fiveMinute).not.toBeNull();
    expect(sweep.direction).toBe("bullish");

    // The bearish machine receives the SAME bullish sweep, not a flipped
    // or dropped one: its read matches a direct run given that sweep.
    const bearishSeries = fullSequence().map((c) => ({
      ...c,
      open: 200 - c.open,
      high: 200 - c.low,
      low: 200 - c.high,
      close: 200 - c.close,
    }));
    const viaRunner = run({
      fiveMinute: series(bearishSeries),
      oneMinute: null,
      sweepEvidence: sweep,
    });
    const direct = runReclaimMachine(
      {
        symbol: "TEST",
        sessionDate: "2026-07-13",
        direction: "bearish",
        timeframe: "five_minute",
        candles: bearishSeries,
        atr: ATR,
        priorDayLevel: LEVEL_LOW,
        premarketLevel: null,
        premarketAvailableFromIndex: null,
        openingRangeLevel: null,
        openingRangeAvailableFromIndex: null,
        regularSessionStartIndex: null,
        structureLevel: 99.5,
        structureAvailableFromTime: T0,
        sweepEvidence: sweep,
        freshness: "real_time",
        volumePace: null,
        benchmarkRelativeMove: null,
      },
      CONFIG
    );
    expect(viaRunner.fiveMinute!.direction).toBe("bearish");
    expect(viaRunner.fiveMinute).toEqual(direct);
  });
});

// ---------------------------------------------------------------------------
// 43, 44 — alignment
// ---------------------------------------------------------------------------

describe("alignment", () => {
  const at = (stage: string, direction = "bullish") =>
    ({ stage, direction, reclaimStatus: "confirmed" } as unknown as ReclaimMachineResult);

  it("reports aligned when both agree and sit within one stage", () => {
    expect(computeAlignment(at("acceptance"), at("acceptance"))).toBe("aligned");
    expect(computeAlignment(at("acceptance"), at("level_test"))).toBe("aligned");
    expect(computeAlignment(at("level_test"), at("acceptance"))).toBe("aligned");
  });

  it("reports one_minute_leading when the scout is more than a stage ahead", () => {
    expect(computeAlignment(at("exhaustion"), at("acceptance"))).toBe("one_minute_leading");
    expect(computeAlignment(at("reset"), at("level_test"))).toBe("one_minute_leading");
  });

  it("reports conflicting on opposite directions (spec test 44)", () => {
    expect(computeAlignment(at("acceptance", "bullish"), at("acceptance", "bearish"))).toBe(
      "conflicting"
    );
  });

  it("reports conflicting when the scout is live but the referee invalidated", () => {
    expect(computeAlignment(at("invalidated"), at("acceptance"))).toBe("conflicting");
  });

  it("reports unavailable when either read is missing", () => {
    expect(computeAlignment(null, at("acceptance"))).toBe("unavailable");
    expect(computeAlignment(at("acceptance"), null)).toBe("unavailable");
    expect(computeAlignment(at("unavailable"), at("acceptance"))).toBe("unavailable");
  });

  it("blocks Review Now and shows Mixed timeframes when conflicting (spec test 44)", () => {
    // A bullish five-minute continuation against a bearish one-minute read.
    const bearishOneMinute = fullSequence(60).map((c) => ({
      ...c,
      // Mirror the series so the 1m machine resolves bearish.
      open: 200 - c.open,
      high: 200 - c.low,
      low: 200 - c.high,
      close: 200 - c.close,
    }));

    const result = run({
      fiveMinute: series(fullSequence()),
      oneMinute: series(bearishOneMinute),
      priorDayLevel: { high: LEVEL, low: LEVEL_LOW },
    });

    // Precondition: the fixture really does produce opposing directions,
    // so this cannot pass vacuously.
    expect(result.direction).toBe("bullish");
    expect(result.oneMinute!.direction).toBe("bearish");

    expect(result.alignment).toBe("conflicting");
    expect(result.alignmentLabel).toBe(MIXED_TIMEFRAMES_LABEL);
    // The five-minute machine alone would have justified Review Now.
    expect(result.fiveMinuteTier).toBe("review_now");
    // Disagreement blocks it.
    expect(result.alertTier).toBe("monitor");
    expect(result.reviewBlockedByAlignment).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 43 — ranking with alignment inserted after stage
// ---------------------------------------------------------------------------

describe("ranking", () => {
  function candidate(overrides: Partial<ReclaimSymbolResult>): ReclaimSymbolResult {
    return {
      symbol: "AAA",
      sessionDate: "2026-07-13",
      fiveMinute: {
        stageChangedAt: T0,
        volumePace: null,
        distanceToNextLevelAtr: null,
        reclaimStatus: "confirmed",
      } as ReclaimMachineResult,
      oneMinute: null,
      historical: null,
      stage: "acceptance",
      direction: "bullish",
      oneMinuteStage: "unavailable",
      alignment: "aligned",
      alignmentLabel: null,
      alertTier: "review_now",
      fiveMinuteTier: "review_now",
      oneMinuteUncappedTier: "none",
      cappedByTimeframe: false,
      reviewBlockedByAlignment: false,
      setupKey: "k",
      isNewSetup: true,
      ambiguous: false,
      ambiguousReason: null,
      ...overrides,
    };
  }

  it("sorts by stage first", () => {
    const ranked = rankReclaimCandidates([
      candidate({ symbol: "LOW", stage: "reset" }),
      candidate({ symbol: "HIGH", stage: "continuation" }),
      candidate({ symbol: "MID", stage: "level_test" }),
    ]);
    expect(ranked.map((r) => r.symbol)).toEqual(["HIGH", "MID", "LOW"]);
  });

  it("then by alignment: aligned, one_minute_leading, conflicting (spec test 43)", () => {
    const ranked = rankReclaimCandidates([
      candidate({ symbol: "CONFLICT", alignment: "conflicting" }),
      candidate({ symbol: "LEADING", alignment: "one_minute_leading" }),
      candidate({ symbol: "ALIGNED", alignment: "aligned" }),
    ]);
    expect(ranked.map((r) => r.symbol)).toEqual(["ALIGNED", "LEADING", "CONFLICT"]);
  });

  it("then by recency, then participation", () => {
    const base = { stage: "acceptance" as const, alignment: "aligned" as const };
    const byRecency = rankReclaimCandidates([
      candidate({
        ...base,
        symbol: "OLD",
        fiveMinute: { stageChangedAt: T0, volumePace: null } as ReclaimMachineResult,
      }),
      candidate({
        ...base,
        symbol: "NEW",
        fiveMinute: { stageChangedAt: T0 + 900, volumePace: null } as ReclaimMachineResult,
      }),
    ]);
    expect(byRecency[0].symbol).toBe("NEW");

    const byVolume = rankReclaimCandidates([
      candidate({
        ...base,
        symbol: "THIN",
        fiveMinute: { stageChangedAt: T0, volumePace: 1.1 } as ReclaimMachineResult,
      }),
      candidate({
        ...base,
        symbol: "HEAVY",
        fiveMinute: { stageChangedAt: T0, volumePace: 3.4 } as ReclaimMachineResult,
      }),
    ]);
    expect(byVolume[0].symbol).toBe("HEAVY");
  });

  it("sorts null values after real ones, never as zero", () => {
    const ranked = rankReclaimCandidates([
      candidate({
        symbol: "UNKNOWN",
        fiveMinute: { stageChangedAt: T0, volumePace: null } as ReclaimMachineResult,
      }),
      candidate({
        symbol: "TINY",
        fiveMinute: { stageChangedAt: T0, volumePace: 0.1 } as ReclaimMachineResult,
      }),
    ]);
    // A symbol whose pace could not be measured is not "the quietest".
    expect(ranked.map((r) => r.symbol)).toEqual(["TINY", "UNKNOWN"]);
  });

  it("prefers the shorter distance among level-test candidates", () => {
    const ranked = rankReclaimCandidates([
      candidate({
        symbol: "FAR",
        stage: "level_test",
        fiveMinute: {
          stageChangedAt: T0,
          volumePace: null,
          distanceToNextLevelAtr: 0.22,
        } as ReclaimMachineResult,
      }),
      candidate({
        symbol: "NEAR",
        stage: "level_test",
        fiveMinute: {
          stageChangedAt: T0,
          volumePace: null,
          distanceToNextLevelAtr: 0.04,
        } as ReclaimMachineResult,
      }),
    ]);
    expect(ranked[0].symbol).toBe("NEAR");
  });

  it("is total, reproducible and non-mutating", () => {
    const items = [
      candidate({ symbol: "B" }),
      candidate({ symbol: "A" }),
      candidate({ symbol: "C" }),
    ];
    const once = rankReclaimCandidates(items);
    expect(rankReclaimCandidates([...items].reverse())).toEqual(once);
    expect(compareReclaimCandidates(items[0], items[0])).toBe(0);
    // The caller's array is never reordered.
    expect(items.map((i) => i.symbol)).toEqual(["B", "A", "C"]);
  });
});

// ---------------------------------------------------------------------------
// 45, 46 — shared ATR and missing one-minute data
// ---------------------------------------------------------------------------

describe("shared ATR yardstick (spec test 45)", () => {
  it("measures both machines against the same five-minute ATR", () => {
    const result = run({
      fiveMinute: series(fullSequence()),
      oneMinute: series(fullSequence(60)),
      atr: ATR,
    });
    // The same dollar reset reports the same ATR multiple on both
    // machines: the 1m machine never derives its own yardstick.
    expect(result.fiveMinute!.resetAtr).toBeCloseTo(result.oneMinute!.resetAtr!, 9);
    expect(result.fiveMinute!.resetDollars).toBeCloseTo(result.oneMinute!.resetDollars!, 9);
  });

  it("divides both machines' reset by the SAME supplied ATR", () => {
    // The direct proof: on each machine, resetAtr is resetDollars divided
    // by the ATR the runner was given. A one-minute machine deriving its
    // own yardstick from one-minute bars could not satisfy this.
    for (const atr of [0.5, 1.0, 2.0]) {
      const result = run({ atr });
      for (const machine of [result.fiveMinute, result.oneMinute]) {
        expect(machine).not.toBeNull();
        expect(machine!.resetAtr!).toBeCloseTo(machine!.resetDollars! / atr, 9);
      }
    }
  });
});

describe("missing one-minute data (spec test 46)", () => {
  it("still runs the five-minute machine and reports the scout unavailable", () => {
    const result = run({ oneMinute: null });

    expect(result.fiveMinute).not.toBeNull();
    expect(result.stage).toBe("continuation");
    expect(result.fiveMinuteTier).toBe("review_now");
    // The one-minute read is explicitly unavailable, never "found nothing".
    expect(result.oneMinute).toBeNull();
    expect(result.oneMinuteStage).toBe("unavailable");
    expect(result.alignment).toBe("unavailable");
    // A missing scout does not hold back the authoritative machine.
    expect(result.alertTier).toBe("review_now");
  });

  it("fetches nothing itself — candles are inputs", () => {
    // The runner takes both series as data. There is no provider,
    // database or timer reachable from it.
    const source = runReclaimForSymbol.toString();
    expect(source).not.toMatch(/fetch|getCandles|supabase/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-scan continuity and purity
// ---------------------------------------------------------------------------

describe("cross-scan continuity", () => {
  it("re-derives the same setupKey from a growing series", () => {
    const full = fullSequence();
    const earlier = run({ fiveMinute: series(full.slice(0, 9)), oneMinute: null });
    const later = run({ fiveMinute: series(full), oneMinute: null });

    // Identity is re-derived deterministically from the candles rather
    // than carried across scans as a partially-advanced object.
    expect(later.setupKey).toBe(earlier.setupKey);
  });

  it("reports whether the setup is new relative to the previous scan", () => {
    const first = run({ oneMinute: null });
    expect(first.isNewSetup).toBe(true);

    const second = run({ oneMinute: null, previousSetupKeys: [first.setupKey!] });
    expect(second.isNewSetup).toBe(false);
    expect(second.setupKey).toBe(first.setupKey);
  });

  it("holds no module-level state between runs", () => {
    const a = run({ oneMinute: null });
    const b = run({ oneMinute: null });
    expect(a).toEqual(b);
  });

  it("never mutates the candle arrays it is given", () => {
    const five = fullSequence().map((c) => Object.freeze(c));
    const one = fullSequence(60).map((c) => Object.freeze(c));
    expect(() =>
      runReclaimForSymbol(
        runnerInput({ fiveMinute: series(Object.freeze(five) as Candle[]), oneMinute: series(Object.freeze(one) as Candle[]) }),
        CONFIG
      )
    ).not.toThrow();
    expect(five).toHaveLength(12);
  });

  it("passes freshness through to both machines", () => {
    const blocked = run({ freshness: "stale" });
    expect(blocked.stage).toBe("unavailable");
    expect(blocked.alertTier).toBe("none");
    expect(blocked.alignment).toBe("unavailable");
  });

  it("keeps an invalidated five-minute setup as history, not as the winner", () => {
    const invalidating = [
      ...fullSequence().slice(0, 5),
      bar(5, 99.9, 99.95, 98.0, 98.1), // completed adverse close
    ];
    const result = run({ fiveMinute: series(invalidating), oneMinute: null });
    expect(result.fiveMinute).toBeNull();
    expect(result.historical).not.toBeNull();
    expect(result.historical!.stage).toBe("invalidated");
    expect(result.alertTier).toBe("none");
  });
});
