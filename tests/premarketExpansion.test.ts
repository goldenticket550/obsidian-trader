import { describe, it, expect } from "vitest";
import {
  assessConfirmation,
  assessFreshness,
  chooseInvalidation,
  computePremarketRanges,
  detectPremarketExpansion,
  describeInteraction,
  freshnessAllowsNewCandidate,
  measureMoveFromPriorClose,
  measurePriorDayInteraction,
  measurePriorLevelProximity,
  measureRangeExpansion,
  measureRangePosition,
  measureRelativeStrength,
  measureStructure,
  measureVolumePace,
  selectActiveLevel,
  assertValidPremarketExpansionConfig,
  validatePremarketExpansionConfig,
  ALL_EVIDENCE_GROUPS,
  CORROBORATING_GROUPS,
  type ActiveLevel,
  type FeedDelayInfo,
  type PremarketExpansionInput,
} from "@/lib/indicators/premarketExpansion";
import {
  formatCollapsedRow,
  formatExpandedEvidence,
} from "@/lib/indicators/premarketExpansionDisplay";
import type { SessionWindowAggregate } from "@/lib/market-data/historicalBaseline";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import type { Candle } from "@/types/candle";

/**
 * Premarket Expansion Candidate — Part 1 of the approved build spec.
 *
 * That spec supersedes the earlier rule-table draft, so the two things it
 * changed most are asserted hardest here: there is NO Expansion Rank
 * anywhere, and the premarket REFERENCE range (which excludes the
 * evaluation bar) is a different quantity from the displayed SESSION
 * range (which includes it).
 */

const config = defaultStrategyConfig.premarketExpansion;
const TODAY = "2026-07-13";
const REALTIME: FeedDelayInfo = { delayed: false, knownDelayMinutes: null };

/** Epoch seconds for a US Eastern minute-of-day during EDT. */
function etTime(date: string, minuteOfDay: number): number {
  const utcMinutes = minuteOfDay + 4 * 60;
  const hh = String(Math.floor(utcMinutes / 60)).padStart(2, "0");
  const mm = String(utcMinutes % 60).padStart(2, "0");
  return Math.floor(Date.parse(`${date}T${hh}:${mm}:00Z`) / 1000);
}

function bar(minute: number, o: number, h: number, l: number, c: number, v = 1000): Candle {
  return { time: etTime(TODAY, minute), open: o, high: h, low: l, close: c, volume: v };
}

function dailyBar(date: string, high: number, low: number, close: number): Candle {
  return {
    time: Math.floor(Date.parse(`${date}T20:00:00Z`) / 1000),
    open: close,
    high,
    low,
    close,
    volume: 1_000_000,
  };
}

function aggregate(overrides: Partial<SessionWindowAggregate> = {}): SessionWindowAggregate {
  return {
    tradingDate: TODAY,
    volume: 100_000,
    dollarVolume: 10_000_000,
    high: 105,
    low: 100,
    range: 5,
    open: 100,
    close: 104,
    barCount: 50,
    expectedBarCount: 65,
    coverage: 50 / 65,
    firstBarMinutes: 240,
    lastBarMinutes: 560,
    ...overrides,
  };
}

function baselineSessions(count: number, volume: number, range: number): SessionWindowAggregate[] {
  return Array.from({ length: count }, (_, i) =>
    aggregate({
      tradingDate: `2026-06-${String(i + 1).padStart(2, "0")}`,
      volume,
      range,
      high: 100 + range,
      low: 100,
    })
  );
}

// ---------------------------------------------------------------------------
// Test 1, 2 — move from prior close
// ---------------------------------------------------------------------------

describe("premarket move", () => {
  const daily = [dailyBar("2026-07-10", 110, 100, 105)];

  it("uses the prior REGULAR-session close (spec test 1)", () => {
    const result = measureMoveFromPriorClose(bar(560, 106, 107, 106, 106.75), daily, TODAY);
    expect(result.priorClose).toBe(105);
    expect(result.dollarMove).toBeCloseTo(1.75, 10);
    expect(result.percentMove).toBeCloseTo((1.75 / 105) * 100, 10);
  });

  it("does not accidentally use an extended-hours close (spec test 2)", () => {
    // Today's still-forming daily bar sits last in the array, and a late
    // after-hours print would have moved a positional lookup. Neither may
    // become the reference.
    const withTodayPartial = [...daily, dailyBar(TODAY, 999, 1, 998)];
    const result = measureMoveFromPriorClose(
      bar(560, 106, 107, 106, 106.75),
      withTodayPartial,
      TODAY
    );
    expect(result.priorClose).toBe(105);
    expect(result.priorClose).not.toBe(998);
  });

  it("reports insufficientData rather than zero when there is no prior close", () => {
    const result = measureMoveFromPriorClose(bar(560, 106, 107, 106, 106.75), [], TODAY);
    expect(result.insufficientData).toBe(true);
    expect(result.dollarMove).toBeNull();
  });

  it("returns a null percent rather than Infinity for a non-positive prior close", () => {
    const result = measureMoveFromPriorClose(
      bar(560, 1, 1, 1, 1),
      [dailyBar("2026-07-10", 0, 0, 0)],
      TODAY
    );
    expect(result.percentMove).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 21, 20 — reference range vs session range
// ---------------------------------------------------------------------------

describe("premarket reference range vs displayed session range", () => {
  const bars = [
    bar(240, 100, 102, 99, 101),
    bar(245, 101, 103, 100, 102),
    bar(250, 102, 104, 101, 103),
    bar(255, 103, 110, 102, 109), // the evaluation bar, and the day's high
  ];

  it("excludes the evaluation candle from the reference range but includes it in the session range (spec test 21)", () => {
    const ranges = computePremarketRanges(bars, config.minReferenceBars);
    expect(ranges.referenceHigh).toBe(104); // highest of the first three bars
    expect(ranges.sessionHigh).toBe(110); // includes the evaluation bar
    expect(ranges.referenceLow).toBe(99);
    expect(ranges.sessionLow).toBe(99);
    expect(ranges.evaluationBar).toBe(bars[3]);
  });

  it("lets the evaluation candle read above 100% of the reference range (spec test 20)", () => {
    const ranges = computePremarketRanges(bars, config.minReferenceBars);
    const result = measureRangePosition(109, ranges, "bullish", config);
    // (109 − 99) / (104 − 99) = 200%
    expect(result.rawPositionPercent).toBeCloseTo(200, 10);
    expect(result.displayPositionPercent).toBe(100);
    expect(result.breakState).toBe("above_reference");
  });

  it("lets the evaluation candle read below 0% of the reference range (spec test 20, mirror)", () => {
    const down = [...bars.slice(0, 3), bar(255, 103, 103, 90, 91)];
    const ranges = computePremarketRanges(down, config.minReferenceBars);
    const result = measureRangePosition(91, ranges, "bearish", config);
    expect(result.rawPositionPercent).toBeLessThan(0);
    expect(result.displayPositionPercent).toBe(0);
    expect(result.breakState).toBe("below_reference");
  });

  it("requires a minimum number of preceding bars before establishing a reference range", () => {
    const ranges = computePremarketRanges(bars.slice(0, 2), config.minReferenceBars);
    expect(ranges.insufficientData).toBe(true);
    expect(ranges.referenceHigh).toBeNull();
    // The session range is still reportable — it needs no history.
    expect(ranges.sessionHigh).toBe(103);
  });

  it("treats a zero-width reference range as insufficient data, not a range of zero (spec test 5)", () => {
    const flat = [
      bar(240, 100, 100, 100, 100),
      bar(245, 100, 100, 100, 100),
      bar(250, 100, 100, 100, 100),
    ];
    const ranges = computePremarketRanges(flat, config.minReferenceBars);
    expect(ranges.insufficientData).toBe(true);

    const position = measureRangePosition(100, ranges, "bullish", config);
    expect(position.insufficientData).toBe(true);
    expect(position.displayPositionPercent).toBeNull();
  });

  it("classifies zones from the clamped value", () => {
    const ranges = computePremarketRanges(
      [bar(240, 100, 110, 100, 105), bar(245, 105, 110, 100, 105), bar(250, 105, 106, 104, 105)],
      config.minReferenceBars
    );
    expect(measureRangePosition(109, ranges, "bullish", config).zone).toBe("upper");
    expect(measureRangePosition(105, ranges, "bullish", config).zone).toBe("middle");
    expect(measureRangePosition(101, ranges, "bullish", config).zone).toBe("lower");
  });

  it("mirrors — the lower zone is favorable for a bearish read", () => {
    const ranges = computePremarketRanges(
      [bar(240, 100, 110, 100, 105), bar(245, 105, 110, 100, 105), bar(250, 105, 106, 104, 105)],
      config.minReferenceBars
    );
    expect(measureRangePosition(101, ranges, "bearish", config).state).toBe("pass");
    expect(measureRangePosition(109, ranges, "bearish", config).state).toBe("wait");
  });
});

// ---------------------------------------------------------------------------
// Tests 3, 4, 22, 23 — baselines
// ---------------------------------------------------------------------------

describe("volume and range baselines", () => {
  it("compares identical elapsed intervals for volume (spec test 3)", () => {
    const result = measureVolumePace(
      aggregate({ volume: 320_000 }),
      baselineSessions(18, 100_000, 5),
      60,
      config
    );
    expect(result.multiple).toBeCloseTo(3.2, 10);
    expect(result.baselineSampleSize).toBe(18);
    expect(result.state).toBe("pass");
  });

  it("compares identical elapsed intervals for range (spec test 4)", () => {
    const result = measureRangeExpansion(
      aggregate({ range: 6.1 }),
      baselineSessions(18, 100_000, 3.4),
      config
    );
    expect(result.sessionValue).toBeCloseTo(6.1, 10);
    expect(result.referenceValue).toBeCloseTo(3.4, 10);
    expect(result.multiple).toBeCloseTo(6.1 / 3.4, 10);
  });

  it("rejects a baseline median volume of 499 and accepts 500 (spec test 22)", () => {
    const under = measureVolumePace(
      aggregate({ volume: 10_000 }),
      baselineSessions(18, 499, 5),
      60,
      config
    );
    expect(under.insufficientData).toBe(true);
    expect(under.reason).toBe("baseline_too_small");
    expect(under.multiple).toBeNull();

    const at = measureVolumePace(
      aggregate({ volume: 10_000 }),
      baselineSessions(18, 500, 5),
      60,
      config
    );
    expect(at.insufficientData).toBe(false);
    expect(at.multiple).toBeCloseTo(20, 10);
  });

  it("rejects a 14-minute elapsed window and accepts 15 minutes (spec test 23)", () => {
    const under = measureVolumePace(
      aggregate({ volume: 320_000 }),
      baselineSessions(18, 100_000, 5),
      14,
      config
    );
    expect(under.insufficientData).toBe(true);
    expect(under.reason).toBe("insufficient_elapsed_time");

    const at = measureVolumePace(
      aggregate({ volume: 320_000 }),
      baselineSessions(18, 100_000, 5),
      15,
      config
    );
    expect(at.insufficientData).toBe(false);
  });

  it("reports insufficient sessions below the configured minimum, with the real sample size", () => {
    const result = measureVolumePace(
      aggregate({ volume: 320_000 }),
      baselineSessions(9, 100_000, 5),
      60,
      config
    );
    expect(result.reason).toBe("insufficient_sessions");
    expect(result.baselineSampleSize).toBe(9);
  });

  it("is satisfied at exactly the 10-session minimum", () => {
    const result = measureVolumePace(
      aggregate({ volume: 320_000 }),
      baselineSessions(10, 100_000, 5),
      60,
      config
    );
    expect(result.insufficientData).toBe(false);
  });

  it("never converts insufficient data to zero, 1×, a pass, or a fail", () => {
    const result = measureVolumePace(null, [], null, config);
    expect(result.multiple).toBeNull();
    expect(result.state).toBe("unavailable");
    expect(result.state).not.toBe("wait");
    expect(result.reason).toBe("no_current_window");
  });
});

// ---------------------------------------------------------------------------
// Tests 6, 7 — relative strength
// ---------------------------------------------------------------------------

describe("relative performance vs benchmark", () => {
  const symbolDaily = [dailyBar("2026-07-10", 110, 100, 100)];
  const benchDaily = [dailyBar("2026-07-10", 510, 490, 500)];
  const SAME = 560;

  function relative(symbolPrice: number, benchPrice: number, benchMinute = SAME) {
    return measureRelativeStrength(
      "QQQ",
      measureMoveFromPriorClose(
        bar(SAME, symbolPrice, symbolPrice, symbolPrice, symbolPrice),
        symbolDaily,
        TODAY
      ),
      measureMoveFromPriorClose(
        bar(benchMinute, benchPrice, benchPrice, benchPrice, benchPrice),
        benchDaily,
        TODAY
      ),
      etTime(TODAY, SAME),
      etTime(TODAY, benchMinute),
      "bullish",
      config
    );
  }

  it("uses matching completed-bar timestamps (spec test 6)", () => {
    const aligned = relative(103, 505);
    expect(aligned.relativePct).toBeCloseTo(2, 10);
    expect(aligned.label).toBe("Outperforming");

    const mismatched = relative(103, 505, 550);
    expect(mismatched.timestampMismatch).toBe(true);
    expect(mismatched.label).toBe("Unavailable");
    expect(mismatched.relativePct).toBeNull();
  });

  it("returns unavailable for missing QQQ data without penalizing the candidate (spec test 7)", () => {
    const result = measureRelativeStrength(
      "QQQ",
      measureMoveFromPriorClose(bar(SAME, 103, 103, 103, 103), symbolDaily, TODAY),
      measureMoveFromPriorClose(null, [], TODAY),
      etTime(TODAY, SAME),
      null,
      "bullish",
      config
    );
    expect(result.state).toBe("unavailable");
    // Crucially NOT "wait" — a data outage must never read as a measured
    // absence of relative strength.
    expect(result.state).not.toBe("wait");
  });

  it("labels a difference inside the tolerance as approximately aligned, boundary inclusive", () => {
    expect(relative(101.2, 505).label).toBe("Approximately aligned");
    expect(relative(101.25, 505).label).toBe("Approximately aligned");
  });

  it("mirrors — underperformance is the bearish pass", () => {
    expect(relative(99, 505).state).toBe("wait");
    const bearish = measureRelativeStrength(
      "QQQ",
      measureMoveFromPriorClose(bar(SAME, 99, 99, 99, 99), symbolDaily, TODAY),
      measureMoveFromPriorClose(bar(SAME, 505, 505, 505, 505), benchDaily, TODAY),
      etTime(TODAY, SAME),
      etTime(TODAY, SAME),
      "bearish",
      config
    );
    expect(bearish.state).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Tests 8 — prior-day level, signed convention
// ---------------------------------------------------------------------------

describe("prior-day level proximity", () => {
  const daily = [dailyBar("2026-07-10", 340.62, 330, 334)];

  it("uses percentage/ATR tolerance, taking the larger (spec test 8)", () => {
    // percent tolerance = 0.25% of 340.62 ≈ $0.85; ATR tolerance = 0.10 × $20 = $2.00.
    const wideAtr = measurePriorLevelProximity(339, daily, TODAY, 20, "bullish", config);
    expect(wideAtr.toleranceDollars).toBeCloseTo(2, 10);
    expect(wideAtr.interaction).toBe("approaching");

    const tightAtr = measurePriorLevelProximity(339, daily, TODAY, 0.1, "bullish", config);
    expect(tightAtr.toleranceDollars).toBeCloseTo((0.25 / 100) * 340.62, 10);
    expect(tightAtr.interaction).toBe("not_near");
  });

  it("signs the distance as currentPrice − level in both directions", () => {
    const below = measurePriorLevelProximity(339.78, daily, TODAY, 5, "bullish", config);
    expect(below.signedDistance).toBeCloseTo(-0.84, 10);
    expect(below.absoluteDistance).toBeCloseTo(0.84, 10);
    expect(below.percentDistance).toBeCloseTo((0.84 / 340.62) * 100, 10);

    // The bearish level is the prior LOW, and the sign convention is the same.
    const bearish = measurePriorLevelProximity(331, daily, TODAY, 5, "bearish", config);
    expect(bearish.level).toBe(330);
    expect(bearish.signedDistance).toBeCloseTo(1, 10);
  });

  it("distinguishes testing, broken, accepted and rejected", () => {
    const testing = measurePriorLevelProximity(340.6, daily, TODAY, 0.01, "bullish", config);
    expect(testing.interaction).toBe("testing");

    const broken = measurePriorLevelProximity(342, daily, TODAY, 0.01, "bullish", config);
    expect(broken.interaction).toBe("broken");

    const accepted = measurePriorLevelProximity(342, daily, TODAY, 0.01, "bullish", config, {
      everTradedBeyond: true,
      accepted: true,
    });
    expect(accepted.interaction).toBe("accepted");
    // A break and an accepted break are not the same state.
    expect(accepted.interaction).not.toBe(broken.interaction);

    const rejected = measurePriorLevelProximity(335, daily, TODAY, 0.01, "bullish", config, {
      everTradedBeyond: true,
      accepted: false,
    });
    expect(rejected.interaction).toBe("rejected");
  });

  it("renders the real distance beside every label", () => {
    const below = measurePriorLevelProximity(339.78, daily, TODAY, 5, "bullish", config);
    expect(describeInteraction(below, "bullish")).toMatch(/\$0\.84 \(0\.25%\)/);

    const broken = measurePriorLevelProximity(341.46, daily, TODAY, 0.01, "bullish", config);
    expect(describeInteraction(broken, "bullish")).toMatch(/Broken, \$0\.84 \(0\.25%\) above/);
  });

  it("reports unavailable with no prior session", () => {
    const result = measurePriorLevelProximity(339.78, [], TODAY, 5, "bullish", config);
    expect(result.insufficientData).toBe(true);
    expect(result.interaction).toBe("unavailable");
    expect(measurePriorDayInteraction(result).state).toBe("unavailable");
  });

  it("counts a real interaction as evidence but mere distance as not", () => {
    const near = measurePriorLevelProximity(339, daily, TODAY, 20, "bullish", config);
    expect(measurePriorDayInteraction(near).state).toBe("pass");

    const far = measurePriorLevelProximity(300, daily, TODAY, 1, "bullish", config);
    expect(measurePriorDayInteraction(far).state).toBe("wait");
  });
});

// ---------------------------------------------------------------------------
// structure group
// ---------------------------------------------------------------------------

describe("structure group", () => {
  function higherLows(): Candle[] {
    return [
      bar(240, 100, 101, 100, 100.5),
      bar(245, 100, 101, 99.8, 100.2),
      bar(250, 100, 100.5, 99, 99.5), // pivot low #1
      bar(255, 99.5, 101, 99.6, 100.8),
      bar(260, 101, 102, 100.5, 101.5),
      bar(265, 101.5, 102, 100.2, 101),
      bar(270, 101, 101.5, 100, 100.5), // pivot low #2
      bar(275, 100.5, 102, 100.6, 101.8),
      bar(280, 102, 103, 101.5, 102.5),
    ];
  }

  it("passes on ascending pivot lows", () => {
    const result = measureStructure(higherLows(), "bullish", 2);
    expect(result.previousPivotPrice).toBeCloseTo(99, 10);
    expect(result.latestPivotPrice).toBeCloseTo(100, 10);
    expect(result.state).toBe("pass");
  });

  it("reports insufficientData rather than a failure when too few pivots exist yet", () => {
    const result = measureStructure(higherLows().slice(0, 4), "bullish", 2);
    expect(result.state).toBe("unavailable");
  });

  it("mirrors to pivot highs for a bearish read", () => {
    expect(measureStructure(higherLows(), "bearish", 2).state).not.toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Tests 18, 19 — active levels and acceptance
// ---------------------------------------------------------------------------

describe("active confirmation levels and acceptance", () => {
  const levels: ActiveLevel[] = [
    { name: "premarket_reference", price: 104 },
    { name: "prior_day", price: 110 },
  ];

  it("selects the nearest unbroken level in the direction of travel", () => {
    expect(selectActiveLevel(levels, 100, "bullish")!.price).toBe(104);
    expect(selectActiveLevel(levels, 105, "bullish")!.price).toBe(110);
    expect(selectActiveLevel(levels, 115, "bullish")).toBeNull();
  });

  it("mirrors the selection for a bearish read", () => {
    expect(selectActiveLevel(levels, 115, "bearish")!.price).toBe(110);
    expect(selectActiveLevel(levels, 105, "bearish")!.price).toBe(104);
    expect(selectActiveLevel(levels, 100, "bearish")).toBeNull();
  });

  it("asks for a break while an unbroken reference remains", () => {
    const result = assessConfirmation([], levels, 100, "bullish");
    expect(result.state).toBe("awaiting_break");
    expect(result.activeLevel!.price).toBe(104);
  });

  it("does NOT treat a first close above both levels as accepted (spec test 18)", () => {
    // One bar through a level is the most common shape of a failed break.
    const candles = [bar(240, 110, 112, 109.5, 111)];
    const result = assessConfirmation(candles, levels, 111, "bullish");
    expect(result.state).toBe("awaiting_acceptance");
    expect(result.closesBeyond).toBe(1);
  });

  it("reports breakout accepted after two completed closes beyond (spec test 19)", () => {
    const candles = [bar(240, 110, 112, 109.5, 111), bar(245, 111, 113, 110.5, 112)];
    const result = assessConfirmation(candles, levels, 112, "bullish");
    expect(result.state).toBe("accepted");
    expect(result.closesBeyond).toBe(2);
  });

  it("also accepts on a break, controlled retest, and close back in the breakout direction", () => {
    const candles = [
      bar(240, 110, 112, 109.5, 111), // first close above 110
      bar(245, 111, 112, 109.8, 111.5), // traded back to 110 and still closed above
    ];
    const result = assessConfirmation(candles, levels, 111.5, "bullish");
    expect(result.retestHeld).toBe(true);
    expect(result.state).toBe("accepted");
  });

  it("mirrors acceptance for a breakdown", () => {
    const candles = [bar(240, 104, 104, 102, 103), bar(245, 103, 103.5, 101, 102)];
    const result = assessConfirmation(candles, levels, 102, "bearish");
    expect(result.state).toBe("accepted");
  });

  it("reports unavailable when there are no levels at all", () => {
    expect(assessConfirmation([], [], 100, "bullish").state).toBe("unavailable");
    expect(assessConfirmation([], levels, null, "bullish").state).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// Hardening A — the 1.5x thresholds are configuration, not literals
// ---------------------------------------------------------------------------

describe("centralized premarket-expansion thresholds", () => {
  function aggregate(volume: number, range: number): SessionWindowAggregate {
    return {
      tradingDate: TODAY,
      volume,
      dollarVolume: volume * 100,
      high: 100 + range,
      low: 100,
      range,
      open: 100,
      close: 100,
      barCount: 60,
      expectedBarCount: 65,
      coverage: 60 / 65,
      firstBarMinutes: 240,
      lastBarMinutes: 560,
    };
  }
  const baseline = Array.from({ length: 12 }, () => aggregate(1000, 1));

  it("keeps the shipped defaults at the documented 1.5x", () => {
    expect(config.volumePaceMinMultiple).toBe(1.5);
    expect(config.rangeExpansionMinMultiple).toBe(1.5);
    expect(config.requiredConsecutiveCloses).toBe(2);
  });

  it("passes volume pace at exactly the threshold and not just below it", () => {
    expect(measureVolumePace(aggregate(1500, 1), baseline, 60, config).state).toBe("pass");
    expect(measureVolumePace(aggregate(1499, 1), baseline, 60, config).state).toBe("wait");
  });

  it("passes range expansion at exactly the threshold and not just below it", () => {
    expect(measureRangeExpansion(aggregate(1000, 1.5), baseline, config).state).toBe("pass");
    expect(measureRangeExpansion(aggregate(1000, 1.4999), baseline, config).state).toBe("wait");
  });

  it("honors a tuned threshold rather than a hard-coded 1.5", () => {
    const strict = { ...config, volumePaceMinMultiple: 3, rangeExpansionMinMultiple: 3 };
    expect(measureVolumePace(aggregate(1500, 1), baseline, 60, strict).state).toBe("wait");
    expect(measureVolumePace(aggregate(3000, 1), baseline, 60, strict).state).toBe("pass");
    expect(measureRangeExpansion(aggregate(1000, 2), baseline, strict).state).toBe("wait");
    expect(measureRangeExpansion(aggregate(1000, 3), baseline, strict).state).toBe("pass");
  });

  it("honors a tuned consecutive-close requirement", () => {
    const levels: ActiveLevel[] = [{ name: "prior_day", price: 110 }];
    const candles = [
      bar(240, 110, 112, 110.5, 111),
      bar(245, 111, 113, 110.5, 112),
    ];
    expect(assessConfirmation(candles, levels, 112, "bullish", 2).state).toBe("accepted");
    expect(assessConfirmation(candles, levels, 112, "bullish", 3).state).toBe(
      "awaiting_acceptance"
    );
  });

  it("rejects thresholds that are not finite, positive and sensible", () => {
    expect(validatePremarketExpansionConfig(config)).toEqual([]);
    expect(validatePremarketExpansionConfig({ ...config, volumePaceMinMultiple: NaN })).toContain(
      "volumePaceMinMultiple must be a finite number"
    );
    expect(validatePremarketExpansionConfig({ ...config, volumePaceMinMultiple: -1 })).toContain(
      "volumePaceMinMultiple must be greater than 0"
    );
    expect(
      validatePremarketExpansionConfig({ ...config, rangeExpansionMinMultiple: 0 })
    ).toContain("rangeExpansionMinMultiple must be greater than 0");
    expect(
      validatePremarketExpansionConfig({ ...config, rangeExpansionMinMultiple: 1000 })
    ).toContain("rangeExpansionMinMultiple must be at most 100");
    // Zero consecutive closes would accept every single first break.
    expect(
      validatePremarketExpansionConfig({ ...config, requiredConsecutiveCloses: 0 })
    ).toContain("requiredConsecutiveCloses must be an integer of at least 1");
    expect(
      validatePremarketExpansionConfig({ ...config, requiredConsecutiveCloses: 1.5 })
    ).toContain("requiredConsecutiveCloses must be an integer of at least 1");
    expect(validatePremarketExpansionConfig({ ...config, minGroupsToQualify: 0 })).toContain(
      "minGroupsToQualify must be between 1 and 6"
    );
    expect(validatePremarketExpansionConfig({ ...config, minGroupsToQualify: 7 })).toContain(
      "minGroupsToQualify must be between 1 and 6"
    );
  });

  it("refuses to evaluate a candidate under an invalid config", () => {
    expect(() =>
      assertValidPremarketExpansionConfig({ ...config, requiredConsecutiveCloses: 0 })
    ).toThrow(/Invalid premarketExpansion config/);
  });
});

// ---------------------------------------------------------------------------
// Finding 1 — acceptance must be continuous, not a running tally
// ---------------------------------------------------------------------------

describe("acceptance is continuous, not a count of closes beyond", () => {
  const levels: ActiveLevel[] = [
    { name: "premarket_reference", price: 104 },
    { name: "prior_day", price: 110 },
  ];

  it("does not accept a break, a failed close back below, and a second break", () => {
    // Two closes beyond exist, but they are two SEPARATE attempts split by a
    // completed close back through the level. Counting them would report a
    // failed break as an accepted breakout.
    const candles = [
      bar(240, 110, 112, 109.5, 111), // break
      bar(245, 111, 111.5, 104, 105), // failed back below the level
      bar(250, 105, 112, 105, 111), // a NEW break, one close old
    ];
    const result = assessConfirmation(candles, levels, 111, "bullish");
    expect(result.state).toBe("awaiting_acceptance");
    expect(result.acceptanceMethod).toBeNull();
    expect(result.consecutiveClosesBeyond).toBe(1);
  });

  it("mirrors that for a breakdown", () => {
    const candles = [
      bar(240, 104, 104, 102, 103), // break below 104
      bar(245, 103, 110, 103, 109), // failed back above the level
      bar(250, 109, 109, 102, 103), // a NEW break, one close old
    ];
    const result = assessConfirmation(candles, levels, 103, "bearish");
    expect(result.state).toBe("awaiting_acceptance");
    expect(result.acceptanceMethod).toBeNull();
    expect(result.consecutiveClosesBeyond).toBe(1);
  });

  it("accepts two CONSECUTIVE closes beyond and names the method", () => {
    const candles = [
      bar(240, 110, 112, 109.5, 111),
      bar(245, 111, 113, 110.5, 112), // held clean above, never traded back
    ];
    const result = assessConfirmation(candles, levels, 112, "bullish");
    expect(result.state).toBe("accepted");
    expect(result.acceptanceMethod).toBe("consecutive_closes");
    expect(result.consecutiveClosesBeyond).toBe(2);
  });

  it("accepts a break, a controlled retest, and a hold, naming that method instead", () => {
    const candles = [
      bar(240, 110, 112, 109.5, 111), // break above 110
      bar(245, 111, 112, 109.8, 111.5), // traded back TO the level and still closed above
    ];
    const result = assessConfirmation(candles, levels, 111.5, "bullish");
    expect(result.state).toBe("accepted");
    expect(result.acceptanceMethod).toBe("retest_hold");
    expect(result.retestHeld).toBe(true);
  });

  it("mirrors the retest-and-hold route for a breakdown", () => {
    const candles = [
      bar(240, 104, 104, 102, 103), // break below 104
      bar(245, 103, 104.2, 102.5, 103.2), // traded back UP to the level, still closed below
    ];
    const result = assessConfirmation(candles, levels, 103.2, "bearish");
    expect(result.state).toBe("accepted");
    expect(result.acceptanceMethod).toBe("retest_hold");
  });

  it("does not let a retest survive an invalidating close in between", () => {
    // Break, a completed close back through the level, then a reclaim that
    // dips to the level and holds. The reclaim is a NEW attempt with a single
    // close, not a continuation of the original one.
    const candles = [
      bar(240, 110, 112, 109.5, 111), // break
      bar(245, 111, 111.5, 108, 109), // invalidating close, back below
      bar(250, 109, 113, 109.8, 112), // reclaim that retested — a fresh attempt
    ];
    const result = assessConfirmation(candles, levels, 112, "bullish");
    expect(result.state).toBe("awaiting_acceptance");
    expect(result.retestHeld).toBe(false);
    expect(result.acceptanceMethod).toBeNull();
  });

  it("counts a subsequent, genuinely continuous attempt", () => {
    // Same shape as above plus one more hold: the second attempt earns its
    // own two consecutive closes and is accepted on its own merit.
    const candles = [
      bar(240, 110, 112, 109.5, 111),
      bar(245, 111, 111.5, 108, 109),
      bar(250, 109, 113, 110.5, 112),
      bar(255, 112, 114, 111.5, 113),
    ];
    const result = assessConfirmation(candles, levels, 113, "bullish");
    expect(result.state).toBe("accepted");
    expect(result.acceptanceMethod).toBe("consecutive_closes");
  });

  it("still reports the total closes beyond alongside the consecutive run", () => {
    const candles = [
      bar(240, 110, 112, 109.5, 111),
      bar(245, 111, 111.5, 104, 105),
      bar(250, 105, 112, 105, 111),
    ];
    const result = assessConfirmation(candles, levels, 111, "bullish");
    expect(result.closesBeyond).toBe(2);
    expect(result.consecutiveClosesBeyond).toBe(1);
  });

  // Hardening C — the level judged against is frozen, not rolling.
  it("judges every close against the level frozen at the first break", () => {
    // The confirmation candles keep making higher highs. If the required
    // level rolled with them, the second close would be measured against
    // 113 rather than the 110 that was actually broken, and a genuine hold
    // would never register as acceptance.
    const candles = [
      bar(240, 110, 113, 109.5, 111),
      bar(245, 111, 118, 110.5, 112),
    ];
    const result = assessConfirmation(candles, levels, 112, "bullish");
    expect(result.state).toBe("accepted");
    expect(result.acceptanceLevel).toBe(110);

    // ...and the same candles judged against a higher frozen level are not
    // accepted, proving the level is what the decision turns on.
    const higher = assessConfirmation(
      candles,
      [{ name: "prior_day", price: 115 }],
      120,
      "bullish"
    );
    expect(higher.acceptanceLevel).toBe(115);
    expect(higher.state).toBe("awaiting_acceptance");
  });
});

// ---------------------------------------------------------------------------
// invalidation
// ---------------------------------------------------------------------------

describe("invalidation", () => {
  const premarket = [
    bar(240, 100, 101, 99, 100),
    bar(245, 100, 102, 100, 101.5),
    bar(250, 101.5, 103, 101, 102.5),
  ];
  const ranges = computePremarketRanges(premarket, config.minReferenceBars);
  const none = assessConfirmation([], [], null, "bullish");

  it("chooses a real structural level below price for a bullish read", () => {
    const structure = measureStructure(premarket, "bullish", 2);
    const result = chooseInvalidation(102.5, premarket, structure, ranges, none, "bullish");
    expect(result.price).not.toBeNull();
    expect(result.price!).toBeLessThan(102.5);
    expect(["premarket_vwap", "structure_pivot", "premarket_extreme"]).toContain(result.source);
  });

  it("returns Not established rather than inventing a price when nothing sits below", () => {
    const highRanges = computePremarketRanges(
      [bar(240, 200, 201, 199, 200), bar(245, 200, 202, 200, 201), bar(250, 201, 203, 201, 202)],
      config.minReferenceBars
    );
    const result = chooseInvalidation(
      100,
      [],
      measureStructure([], "bullish", 2),
      highRanges,
      none,
      "bullish"
    );
    expect(result.price).toBeNull();
    expect(result.source).toBeNull();
  });

  it("mirrors to the protective side above price for a bearish read", () => {
    const structure = measureStructure(premarket, "bearish", 2);
    const result = chooseInvalidation(99.5, premarket, structure, ranges, none, "bearish");
    expect(result.price).not.toBeNull();
    expect(result.price!).toBeGreaterThan(99.5);
  });
});

// ---------------------------------------------------------------------------
// Tests 15, 16, 17 — freshness
// ---------------------------------------------------------------------------

describe("freshness", () => {
  const latest = bar(560, 100, 101, 99, 100); // 9:20 bar, closes 9:25 ET
  const at = (utc: string) => new Date(Date.parse(utc));

  it("keeps scan time and market-data time as distinct values", () => {
    const result = assessFreshness(at("2026-07-13T13:26:00Z"), latest, 5, REALTIME, false, config);
    expect(result.latestCompletedBarAt).not.toBe(result.scannedAt);
    // Aged from the bar's CLOSE (9:25), not its open.
    expect(result.ageSeconds).toBe(60);
    expect(result.status).toBe("real_time");
  });

  it("does not become partial merely because a live candle is forming (spec test 15)", () => {
    // The caller passes only COMPLETED bars; an ordinarily-forming current
    // candle is simply not among them and must not set partial, which
    // would block every live alert during market hours.
    const result = assessFreshness(at("2026-07-13T13:27:00Z"), latest, 5, REALTIME, false, config);
    expect(result.status).toBe("real_time");
    expect(result.status).not.toBe("partial");
    expect(freshnessAllowsNewCandidate(result.status, REALTIME)).toBe(true);
  });

  it("treats 11-minute-old real-time data as stale and blocks a new alert (spec test 16)", () => {
    // 5m confirmation candles → the boundary is 2 intervals = 10 minutes.
    const result = assessFreshness(at("2026-07-13T13:36:00Z"), latest, 5, REALTIME, false, config);
    expect(result.ageSeconds).toBe(11 * 60);
    expect(result.status).toBe("stale");
    expect(freshnessAllowsNewCandidate(result.status, REALTIME)).toBe(false);
  });

  it("treats exactly 10 minutes as still real-time — there is no undefined band", () => {
    const result = assessFreshness(at("2026-07-13T13:35:00Z"), latest, 5, REALTIME, false, config);
    expect(result.status).toBe("real_time");
  });

  it("labels known bounded-delay data as delayed and still permits an alert (spec test 17)", () => {
    const delayed: FeedDelayInfo = { delayed: true, knownDelayMinutes: 15 };
    const result = assessFreshness(at("2026-07-13T13:40:00Z"), latest, 5, delayed, false, config);
    expect(result.status).toBe("delayed");
    expect(freshnessAllowsNewCandidate(result.status, delayed)).toBe(true);
  });

  it("never infers delay from bar age on a real-time feed", () => {
    // Old data on a real-time feed is stale, not "delayed" — conflating
    // them would let genuine staleness masquerade as normal.
    const result = assessFreshness(at("2026-07-13T13:50:00Z"), latest, 5, REALTIME, false, config);
    expect(result.status).toBe("stale");
    expect(result.status).not.toBe("delayed");
  });

  it("treats an unbounded delay as unusable", () => {
    const unbounded: FeedDelayInfo = { delayed: true, knownDelayMinutes: null };
    const result = assessFreshness(at("2026-07-13T13:26:00Z"), latest, 5, unbounded, false, config);
    expect(result.status).toBe("stale");
    expect(freshnessAllowsNewCandidate(result.status, unbounded)).toBe(false);
  });

  it("reports partial when a required dataset is incomplete, and blocks alerting", () => {
    const result = assessFreshness(at("2026-07-13T13:26:00Z"), latest, 5, REALTIME, true, config);
    expect(result.status).toBe("partial");
    expect(freshnessAllowsNewCandidate(result.status, REALTIME)).toBe(false);
  });

  it("reports unavailable with no completed bar", () => {
    const result = assessFreshness(at("2026-07-13T13:26:00Z"), null, 5, REALTIME, false, config);
    expect(result.status).toBe("unavailable");
    expect(result.latestCompletedBarAt).toBeNull();
    expect(freshnessAllowsNewCandidate("unavailable", REALTIME)).toBe(false);
  });

  it("flags severely stale as explanatory text only, not a separate state", () => {
    const result = assessFreshness(at("2026-07-13T13:50:00Z"), latest, 5, REALTIME, false, config);
    expect(result.severelyStale).toBe(true);
    expect(result.status).toBe("stale");
  });
});

// ---------------------------------------------------------------------------
// Tests 9, 10, 11, 12 — the combined candidate
// ---------------------------------------------------------------------------

describe("the evidence-group gate", () => {
  const daily = [dailyBar("2026-07-10", 110, 100, 105)];

  function scanJustAfter(premarket: Candle[]): Date {
    if (premarket.length === 0) return new Date(Date.parse("2026-07-13T13:26:00Z"));
    const last = premarket[premarket.length - 1];
    return new Date((last.time + 5 * 60 + 60) * 1000);
  }

  function buildInput(overrides: Partial<PremarketExpansionInput> = {}): PremarketExpansionInput {
    const premarketCandles = overrides.premarketCandles ?? [];
    return {
      symbol: "GOOGL",
      direction: "bullish",
      confirmationCandles: [],
      dailyCandles: daily,
      todayTradingDate: TODAY,
      todaySession: aggregate(),
      baseline: baselineSessions(18, 100_000, 5),
      elapsedPremarketMinutes: 60,
      dailyAtr: 2,
      benchmarkSymbol: "QQQ",
      benchmarkPremarketCandles: [],
      benchmarkDailyCandles: [dailyBar("2026-07-10", 510, 490, 500)],
      feed: REALTIME,
      datasetIncomplete: false,
      candleIntervalMinutes: 5,
      scannedAt: scanJustAfter(premarketCandles),
      ...overrides,
      premarketCandles,
    };
  }

  const climbing = [
    bar(240, 100, 101, 100, 100.5),
    bar(245, 100.5, 101, 99.8, 100.2),
    bar(250, 100, 100.5, 99, 99.5),
    bar(255, 99.5, 101, 99.6, 100.8),
    bar(260, 101, 102, 100.5, 101.5),
    bar(265, 101.5, 102, 100.2, 101),
    bar(270, 101, 101.5, 100, 100.5),
    bar(275, 100.5, 102, 100.6, 101.8),
  ];

  it("names exactly the six groups", () => {
    const result = detectPremarketExpansion(buildInput(), config);
    expect(result.groups.map((g) => g.name)).toEqual([...ALL_EVIDENCE_GROUPS]);
    expect(ALL_EVIDENCE_GROUPS).toHaveLength(6);
  });

  it("lists the corroborating groups exactly as specified", () => {
    expect([...CORROBORATING_GROUPS]).toEqual([
      "participation",
      "rangeExpansion",
      "priorDayInteraction",
    ]);
  });

  it("does not let three correlated price-location facts satisfy the gate (spec test 9)", () => {
    // rangeLocation + structure + proximity can all restate "price is
    // near its high". With ordinary volume and range, and prior-day
    // levels far away, nothing corroborates and the gate must hold.
    const premarket = [...climbing, bar(280, 102, 103.5, 101.5, 103.4)];
    const result = detectPremarketExpansion(
      buildInput({
        premarketCandles: premarket,
        todaySession: aggregate({ volume: 100_000, range: 5 }),
        baseline: baselineSessions(18, 100_000, 5),
        dailyAtr: 0.01,
      }),
      config
    );

    const passing = result.groups.filter((g) => g.state === "pass").map((g) => g.name);
    expect(passing).not.toContain("participation");
    expect(passing).not.toContain("rangeExpansion");
    expect(passing).not.toContain("priorDayInteraction");
    expect(result.corroboratingGroupPassed).toBe(false);
    expect(result.qualified).toBe(false);
  });

  it("qualifies only with three groups including a corroborating one (spec test 10)", () => {
    const premarket = [...climbing, bar(280, 102, 111.5, 101.5, 111.2)];
    const result = detectPremarketExpansion(
      buildInput({
        premarketCandles: premarket,
        todaySession: aggregate({ volume: 400_000, range: 12 }),
        baseline: baselineSessions(18, 100_000, 5),
      }),
      config
    );

    expect(result.passingGroups).toBeGreaterThanOrEqual(config.minGroupsToQualify);
    expect(result.corroboratingGroupPassed).toBe(true);
    expect(result.qualified).toBe(true);
    expect(result.contextLabel).toBe("Bullish context developing");
  });

  it("mirrors the whole calculation for a bearish candidate (spec test 11)", () => {
    const falling = [
      bar(240, 105, 106, 104, 104.5),
      bar(245, 104.5, 105, 103, 103.5),
      bar(250, 103.5, 104, 102, 102.5),
      bar(255, 102.5, 103, 98, 98.2),
    ];
    const result = detectPremarketExpansion(
      buildInput({
        direction: "bearish",
        premarketCandles: falling,
        todaySession: aggregate({ volume: 400_000, range: 12 }),
      }),
      config
    );
    expect(result.direction).toBe("bearish");
    // Prior-day LOW is the mirrored level.
    expect(result.priorLevel.level).toBe(100);
    expect(result.priorLevel.interaction).toBe("broken");
    expect(result.contextLabel).toContain("Bearish");
    expect(result.rangePosition.breakState).toBe("below_reference");
  });

  it("cannot generate a candidate alert from stale data (spec test 12)", () => {
    const premarket = [...climbing, bar(280, 102, 111.5, 101.5, 111.2)];
    const result = detectPremarketExpansion(
      buildInput({
        premarketCandles: premarket,
        todaySession: aggregate({ volume: 400_000, range: 12 }),
        // 40 minutes after the last bar closed.
        scannedAt: new Date((premarket[premarket.length - 1].time + 5 * 60 + 40 * 60) * 1000),
      }),
      config
    );
    expect(result.freshness.status).toBe("stale");
    expect(result.qualified).toBe(false);
  });

  it("counts only evaluable groups, so missing data never reads as a failure", () => {
    const result = detectPremarketExpansion(
      buildInput({ baseline: baselineSessions(3, 100_000, 5) }),
      config
    );
    const unavailable = result.groups.filter((g) => g.state === "unavailable").map((g) => g.name);
    expect(unavailable).toContain("participation");
    expect(unavailable).toContain("rangeExpansion");
    expect(result.evaluableGroups).toBe(6 - unavailable.length);
  });

  it("uses factual context language and never a prediction", () => {
    const result = detectPremarketExpansion(buildInput(), config);
    expect(result.contextLabel).toMatch(/^(Bullish|Bearish) context (developing|not established)$/);
    expect(result.contextLabel).not.toMatch(/bias|likely|probability|pressure building/i);
  });

  it("exposes an observable stage rather than a score", () => {
    const premarket = [...climbing, bar(280, 102, 111.5, 101.5, 111.2)];
    const accepted = detectPremarketExpansion(
      buildInput({
        premarketCandles: premarket,
        todaySession: aggregate({ volume: 400_000, range: 12 }),
        confirmationCandles: [
          bar(270, 110, 112, 109.5, 111),
          bar(275, 111, 113, 110.5, 111.2),
        ],
      }),
      config
    );
    expect(accepted.confirmation.state).toBe("accepted");
    expect(accepted.stage).toBe("breakout_accepted");
  });

  it("carries no rank, score, or ranking band anywhere in the result (spec test 14)", () => {
    const result = detectPremarketExpansion(buildInput(), config);
    const keys = Object.keys(result);
    expect(keys).not.toContain("expansionRank");
    expect(keys).not.toContain("rankScore");
    expect(keys).not.toContain("rankComponents");
    expect(JSON.stringify(result)).not.toMatch(/rank/i);
  });
});

// ---------------------------------------------------------------------------
// Tests 13, 14 — display
// ---------------------------------------------------------------------------

describe("display formats", () => {
  const daily = [dailyBar("2026-07-10", 340.62, 330, 334)];
  const premarket = [
    bar(545, 336, 338, 335, 337, 4000),
    bar(550, 337, 339, 336, 338, 4500),
    bar(555, 338, 340, 337, 339, 5000),
    bar(560, 339, 340.2, 338.5, 339.78, 5200),
  ];

  function resultFor(overrides: Partial<PremarketExpansionInput> = {}) {
    return detectPremarketExpansion(
      {
        symbol: "GOOGL",
        direction: "bullish",
        premarketCandles: premarket,
        confirmationCandles: [],
        dailyCandles: daily,
        todayTradingDate: TODAY,
        todaySession: aggregate({ high: 340.2, low: 335, range: 5.2, volume: 320_000 }),
        baseline: baselineSessions(18, 100_000, 3.4),
        elapsedPremarketMinutes: 320,
        dailyAtr: 5,
        benchmarkSymbol: "QQQ",
        benchmarkPremarketCandles: [bar(560, 505, 506, 504, 505.6)],
        benchmarkDailyCandles: [dailyBar("2026-07-10", 510, 495, 500)],
        feed: REALTIME,
        datasetIncomplete: false,
        candleIntervalMinutes: 5,
        scannedAt: new Date((etTime(TODAY, 560) + 5 * 60 + 60) * 1000),
        ...overrides,
      },
      config
    );
  }

  it("renders the collapsed row with an evidence COUNT and no rank", () => {
    const [priceLine, badge, metrics, evidence] = formatCollapsedRow(resultFor());
    expect(priceLine).toContain("GOOGL");
    expect(priceLine).toContain("$339.78");
    expect(badge).toContain("Bullish");
    expect(metrics).toContain("PM volume 3.2×");
    expect(evidence).toMatch(/^\d of 6 evidence groups passing$/);
    expect([priceLine, badge, metrics, evidence].join("\n")).not.toMatch(/rank/i);
  });

  it("renders every expanded section", () => {
    const text = formatExpandedEvidence(resultFor()).join("\n");
    expect(text).toContain("PREMARKET CONTEXT");
    expect(text).toContain("Stage");
    expect(text).toContain("Move from prior close");
    expect(text).toContain("Volume pace");
    expect(text).toContain("Premarket range");
    expect(text).toContain("Range vs reference");
    expect(text).toContain("Position in reference range");
    expect(text).toContain("Relative to QQQ");
    expect(text).toContain("Prior-day level");
    expect(text).toContain("EVIDENCE");
    expect(text).toContain("evidence groups passing");
    expect(text).toContain("NEXT");
    expect(text).toContain("Confirmation");
    expect(text).toContain("Invalidation");
  });

  it("shows the displayed premarket range from the SESSION range, not the reference range", () => {
    const result = resultFor();
    const line = formatExpandedEvidence(result)
      .find((l) => l.startsWith("Premarket range"))!;
    // Session high includes the evaluation bar (340.20); the reference
    // high excludes it (340.00).
    expect(result.ranges.sessionHigh).toBe(340.2);
    expect(result.ranges.referenceHigh).toBe(340);
    expect(line).toContain("$340.20");
  });

  it("shows scan time and latest-bar time as visibly distinct lines", () => {
    const lines = formatExpandedEvidence(resultFor());
    const scanned = lines.find((l) => l.startsWith("Scanned at"))!;
    const barLine = lines.find((l) => l.startsWith("Latest completed bar"))!;
    expect(scanned).not.toBe(barLine);
  });

  it("renders Unavailable rather than zero when a measurement is missing (spec test 13)", () => {
    const text = formatExpandedEvidence(
      resultFor({
        baseline: [],
        todaySession: null,
        premarketCandles: [],
        benchmarkPremarketCandles: [],
      })
    ).join("\n");
    expect(text).toContain("Unavailable");
    expect(text).not.toMatch(/Volume pace\s+0\.0×/);
    expect(text).not.toMatch(/\s0\.00%\)/);
  });

  it("renders 'Not established' rather than inventing an invalidation price", () => {
    const text = formatExpandedEvidence(
      resultFor({ premarketCandles: [], todaySession: null })
    ).join("\n");
    expect(text).toContain("Not established");
  });

  it("says plainly that stale data raised no alert", () => {
    const text = formatExpandedEvidence(
      resultFor({ scannedAt: new Date((etTime(TODAY, 560) + 5 * 60 + 40 * 60) * 1000) })
    ).join("\n");
    expect(text).toContain("Stale — no new alert");
  });

  it("asks to hold above BOTH levels after a first break, not 'accepted' (spec test 18, display)", () => {
    const text = formatExpandedEvidence(
      resultFor({
        premarketCandles: [...premarket, bar(565, 340, 342, 340, 341.5)],
        confirmationCandles: [bar(560, 340, 342, 339, 341.5)],
        scannedAt: new Date((etTime(TODAY, 565) + 5 * 60 + 60) * 1000),
      })
    ).join("\n");
    expect(text).toContain("Hold above both premarket and prior-day highs");
    expect(text).not.toContain("Breakout accepted");
  });

  it("reports breakout accepted once the acceptance rule passes (spec test 19, display)", () => {
    const text = formatExpandedEvidence(
      resultFor({
        premarketCandles: [...premarket, bar(565, 340, 342, 340, 341.5)],
        confirmationCandles: [
          bar(555, 340, 342, 339, 341),
          bar(560, 341, 343, 340.5, 341.5),
        ],
        scannedAt: new Date((etTime(TODAY, 565) + 5 * 60 + 60) * 1000),
      })
    ).join("\n");
    expect(text).toContain("Breakout accepted");
  });

  it("mirrors the labels for a bearish candidate", () => {
    const text = formatExpandedEvidence(resultFor({ direction: "bearish" })).join("\n");
    expect(text).toContain("Prior-day low");
  });

  it("does not seed the spec's illustrative example values (spec test 14)", () => {
    const text = formatExpandedEvidence(
      resultFor({ todaySession: aggregate({ high: 50, low: 49, range: 1, volume: 1 }) })
    ).join("\n");
    expect(text).not.toContain("$6.10");
    expect(text).not.toContain("3.2×");
    expect(text).not.toMatch(/Expansion Rank/i);
  });
});
