import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  compareExpansionPriority,
  describePriorityReason,
  sortByExpansionStage,
  EXPANSION_SORT_LABEL,
  EXPANSION_STAGE_PRIORITY,
  type ExpansionPriorityItem,
} from "@/lib/scanner/expansionPriority";
import {
  barDollarVolume,
  buildDollarVolumeContext,
  defaultDollarVolumeConfig,
  measureCloseLocation,
  measureDollarVolumeShock,
  measureTrueRangeShock,
} from "@/lib/indicators/dollarVolume";
import {
  detectEarlyAcceleration,
  eligibleSignificantLevels,
  findEngagedLevel,
  EarlyAlertDeduplicator,
  EARLY_ALERT_LABEL,
  EARLY_ALERT_PRIORITY,
  defaultDeduplicationConfig,
  defaultLevelProximityConfig,
  structuralLevelIdentity,
  type EarlyAccelerationInput,
  type EarlyAlertKey,
  type SignificantLevel,
} from "@/lib/indicators/earlyAcceleration";
import {
  collectTimeOfDayBars,
  computeCompletedBarCutoff,
  filterToCompletedBars,
} from "@/lib/market-data/historicalBaseline";
import { detectPremarketExpansion } from "@/lib/indicators/premarketExpansion";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import type { Candle } from "@/types/candle";

/**
 * Expansion Monitor — Phase 1 only.
 *
 * Phases 2-5 (sector ETFs / gap / compression / extension, catalyst
 * context, forward outcome logging, final UI polish) are deliberately not
 * implemented and not tested here.
 */

const dvConfig = defaultDollarVolumeConfig;
const TODAY = "2026-07-13";

function etTime(date: string, minuteOfDay: number): number {
  const utcMinutes = minuteOfDay + 4 * 60;
  const hh = String(Math.floor(utcMinutes / 60)).padStart(2, "0");
  const mm = String(utcMinutes % 60).padStart(2, "0");
  return Math.floor(Date.parse(`${date}T${hh}:${mm}:00Z`) / 1000);
}

function bar(
  date: string,
  minute: number,
  o: number,
  h: number,
  l: number,
  c: number,
  v = 1000
): Candle {
  return { time: etTime(date, minute), open: o, high: h, low: l, close: c, volume: v };
}

const PRIOR_DATES = [
  "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19",
  "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26",
  "2026-06-29", "2026-06-30",
];

/**
 * An ordinary baseline at 9:31: twelve prior sessions, each with a modest
 * bar at the same minute-of-day plus the bar before it.
 */
/** The dedup key without its level — what `markInvalidated` and friends take. */
function baseOf(key: EarlyAlertKey): Omit<EarlyAlertKey, "level"> {
  const { userId, symbol, direction, tradingDate } = key;
  return { userId, symbol, direction, tradingDate };
}

function ordinaryBaseline(minute = 571, volume = 1000, high = 100.2, low = 100) {
  return PRIOR_DATES.flatMap((d) => [
    bar(d, minute - 1, 100, 100.1, 99.9, 100, volume),
    bar(d, minute, low, high, low, (high + low) / 2, volume),
  ]);
}

// ---------------------------------------------------------------------------
// Section 1 — prioritization (spec tests 1, 2, 3)
// ---------------------------------------------------------------------------

describe("stage-based prioritization", () => {
  function item(overrides: Partial<ExpansionPriorityItem> = {}): ExpansionPriorityItem {
    return {
      symbol: "AAA",
      stage: "inactive",
      atrNormalizedMove: null,
      relativeDollarVolume: null,
      sectorRelativePerformance: null,
      lastConfirmedTransitionAt: null,
      ...overrides,
    };
  }

  it("contains no hidden score (spec test 1)", () => {
    // Priorities are a fixed table of observable stages, not a computed
    // blend, and nothing in the sorted output carries a numeric rank.
    const sorted = sortByExpansionStage([
      item({ symbol: "AAA", stage: "expansion_active" }),
      item({ symbol: "BBB", stage: "inactive" }),
    ]);
    for (const entry of sorted) {
      expect(Object.keys(entry)).not.toContain("score");
      expect(Object.keys(entry)).not.toContain("rank");
      expect(JSON.stringify(entry)).not.toMatch(/rank|score/i);
    }
    // The priority table is exactly the specified mapping.
    expect(EXPANSION_STAGE_PRIORITY).toEqual({
      invalidated: 0,
      inactive: 1,
      context_developing: 2,
      premarket_candidate: 3,
      opening_drive: 4,
      level_break: 5,
      breakout_accepted: 6,
      expansion_active: 7,
      stalled: 2,
    });
  });

  it("puts expansion-active symbols above premarket candidates (spec test 2)", () => {
    const sorted = sortByExpansionStage([
      item({ symbol: "CAND", stage: "premarket_candidate" }),
      item({ symbol: "ACTIVE", stage: "expansion_active" }),
      item({ symbol: "IDLE", stage: "inactive" }),
    ]);
    expect(sorted.map((s) => s.symbol)).toEqual(["ACTIVE", "CAND", "IDLE"]);
  });

  it("resolves same-stage ties with the ATR-normalized move (spec test 3)", () => {
    const sorted = sortByExpansionStage([
      item({ symbol: "SMALL", stage: "level_break", atrNormalizedMove: 0.6 }),
      item({ symbol: "BIG", stage: "level_break", atrNormalizedMove: 1.9 }),
      item({ symbol: "MID", stage: "level_break", atrNormalizedMove: 1.2 }),
    ]);
    expect(sorted.map((s) => s.symbol)).toEqual(["BIG", "MID", "SMALL"]);
  });

  it("uses the absolute move, so a large bearish move ranks with a large bullish one", () => {
    const sorted = sortByExpansionStage([
      item({ symbol: "UP", stage: "level_break", atrNormalizedMove: 1.2 }),
      item({ symbol: "DOWN", stage: "level_break", atrNormalizedMove: -1.9 }),
    ]);
    expect(sorted[0].symbol).toBe("DOWN");
  });

  it("falls through to dollar volume, sector-relative move, transition time, then ticker", () => {
    const base = { stage: "level_break" as const, atrNormalizedMove: 1 };
    const byVolume = sortByExpansionStage([
      item({ ...base, symbol: "LOW", relativeDollarVolume: 1.1 }),
      item({ ...base, symbol: "HIGH", relativeDollarVolume: 3.2 }),
    ]);
    expect(byVolume[0].symbol).toBe("HIGH");

    const bySector = sortByExpansionStage([
      item({ ...base, symbol: "WEAK", relativeDollarVolume: 2, sectorRelativePerformance: 0.4 }),
      item({ ...base, symbol: "STRONG", relativeDollarVolume: 2, sectorRelativePerformance: -1.8 }),
    ]);
    expect(bySector[0].symbol).toBe("STRONG");

    const byTransition = sortByExpansionStage([
      item({ ...base, symbol: "OLD", relativeDollarVolume: 2, lastConfirmedTransitionAt: 1000 }),
      item({ ...base, symbol: "NEW", relativeDollarVolume: 2, lastConfirmedTransitionAt: 5000 }),
    ]);
    expect(byTransition[0].symbol).toBe("NEW");

    const byTicker = sortByExpansionStage([
      item({ ...base, symbol: "ZZZ", relativeDollarVolume: 2, lastConfirmedTransitionAt: 1000 }),
      item({ ...base, symbol: "AAA", relativeDollarVolume: 2, lastConfirmedTransitionAt: 1000 }),
    ]);
    expect(byTicker.map((s) => s.symbol)).toEqual(["AAA", "ZZZ"]);
  });

  it("orders unmeasured tie-breakers last rather than treating them as zero", () => {
    const sorted = sortByExpansionStage([
      item({ symbol: "UNKNOWN", stage: "level_break", atrNormalizedMove: null }),
      item({ symbol: "TINY", stage: "level_break", atrNormalizedMove: 0.1 }),
    ]);
    // A symbol whose move could not be measured has not been shown to
    // have a small move.
    expect(sorted.map((s) => s.symbol)).toEqual(["TINY", "UNKNOWN"]);
  });

  it("is a total, reproducible order", () => {
    const items = [
      item({ symbol: "A", stage: "level_break", atrNormalizedMove: 1 }),
      item({ symbol: "B", stage: "expansion_active", atrNormalizedMove: 0.2 }),
      item({ symbol: "C", stage: "premarket_candidate", relativeDollarVolume: 9 }),
    ];
    expect(sortByExpansionStage(items)).toEqual(sortByExpansionStage([...items].reverse()));
    expect(compareExpansionPriority(items[0], items[0])).toBe(0);
  });

  it("does not mutate its input", () => {
    const items = [
      item({ symbol: "Z", stage: "inactive" }),
      item({ symbol: "A", stage: "expansion_active" }),
    ];
    sortByExpansionStage(items);
    expect(items.map((i) => i.symbol)).toEqual(["Z", "A"]);
  });

  it("explains the ordering with measured values only", () => {
    const reason = describePriorityReason(
      item({
        symbol: "GOOGL",
        stage: "expansion_active",
        atrNormalizedMove: 1.4,
        relativeDollarVolume: 3.2,
      }),
      0
    );
    expect(reason).toBe(
      "GOOGL moved to the top because: Expansion active · 1.4x ATR move · 3.2x dollar-volume pace"
    );

    // An unmeasured tie-breaker is omitted, never rendered as 0.0x.
    const sparse = describePriorityReason(item({ symbol: "AAA", stage: "level_break" }), 1);
    expect(sparse).toBe("AAA is ranked #2 because: Level break");
    expect(sparse).not.toContain("0.0x");
  });

  it("is offered as a separate sort option rather than replacing the default order", () => {
    expect(EXPANSION_SORT_LABEL).toBe("Sort: Expansion Stage");
  });
});

// ---------------------------------------------------------------------------
// Section 3 — dollar volume (spec tests 7, 8, 9)
// ---------------------------------------------------------------------------

describe("dollar-volume shock and acceleration", () => {
  it("uses typicalPrice × volume for a bar's dollar volume", () => {
    const candle = bar(TODAY, 571, 100, 102, 99, 101, 1000);
    // (102 + 99 + 101) / 3 = 100.6667
    expect(barDollarVolume(candle)).toBeCloseTo(((102 + 99 + 101) / 3) * 1000, 6);
  });

  it("compares against MATCHING time-of-day baselines (spec test 7)", () => {
    const history = ordinaryBaseline(571, 1000);
    const baseline = collectTimeOfDayBars(history, 571, TODAY);
    expect(baseline).toHaveLength(12);
    // Every collected bar really is the 9:31 bar of its own session.
    expect(baseline.every((b) => b.previousBar !== null)).toBe(true);

    const shockBar = bar(TODAY, 571, 100, 101, 100, 100.9, 5000);
    const result = measureDollarVolumeShock(shockBar, baseline, dvConfig);
    expect(result.status).toBe("available");
    expect(result.multiple).toBeGreaterThan(4);
    expect(result.passed).toBe(true);
  });

  it("ignores a session with no bar at the matching minute rather than counting it as zero", () => {
    const history = [
      ...ordinaryBaseline(571, 1000),
      // A session that simply did not print at 9:31.
      bar("2026-07-01", 400, 100, 101, 99, 100, 1000),
    ];
    const baseline = collectTimeOfDayBars(history, 571, TODAY);
    expect(baseline.map((b) => b.tradingDate)).not.toContain("2026-07-01");
  });

  it("returns unavailable when the baseline is too small, never a pass or a fail", () => {
    const baseline = collectTimeOfDayBars(ordinaryBaseline(571).slice(0, 8), 571, TODAY);
    const result = measureDollarVolumeShock(
      bar(TODAY, 571, 100, 101, 100, 100.9, 5000),
      baseline,
      dvConfig
    );
    expect(result.status).toBe("insufficient_data");
    expect(result.passed).toBe(false);
    expect(result.multiple).toBeNull();
  });

  it("measures true-range expansion against the same time-of-day baseline", () => {
    const baseline = collectTimeOfDayBars(ordinaryBaseline(571, 1000, 100.2, 100), 571, TODAY);
    const wide = bar(TODAY, 571, 100, 102, 99, 101.8, 1000);
    const result = measureTrueRangeShock(wide, bar(TODAY, 570, 100, 100.1, 99.9, 100), baseline, dvConfig);
    expect(result.status).toBe("available");
    expect(result.multiple).toBeGreaterThan(dvConfig.minimumTrueRangeShockMultiple);
    expect(result.passed).toBe(true);
  });

  it("measures where the candle closed in its own range", () => {
    const strong = bar(TODAY, 571, 100, 102, 100, 101.9);
    expect(measureCloseLocation(strong, "bullish", dvConfig).closeLocation).toBeCloseTo(0.95, 6);
    expect(measureCloseLocation(strong, "bullish", dvConfig).nearExtreme).toBe(true);
    expect(measureCloseLocation(strong, "bearish", dvConfig).nearExtreme).toBe(false);

    const weak = bar(TODAY, 571, 100, 102, 100, 100.1);
    expect(measureCloseLocation(weak, "bullish", dvConfig).nearExtreme).toBe(false);
    expect(measureCloseLocation(weak, "bearish", dvConfig).nearExtreme).toBe(true);

    // A zero-range bar has no defined close location.
    const flat = bar(TODAY, 571, 100, 100, 100, 100);
    expect(measureCloseLocation(flat, "bullish", dvConfig).closeLocation).toBeNull();
  });

  it("compares NON-OVERLAPPING three-bar windows (spec test 8)", () => {
    // Six bars: the first three quiet, the last three heavy. An
    // overlapping comparison would share bars and dampen the ratio.
    const quiet = [571, 572, 573].map((m) => bar(TODAY, m, 100, 100.5, 99.5, 100, 1000));
    const heavy = [574, 575, 576].map((m) => bar(TODAY, m, 100, 101, 100, 100.9, 4000));

    const context = buildDollarVolumeContext([...quiet, ...heavy], [], null, dvConfig);
    expect(context.previousThreeBarDollarVolume).toBeCloseTo(
      quiet.reduce((s, c) => s + barDollarVolume(c), 0),
      6
    );
    expect(context.recentThreeBarDollarVolume).toBeCloseTo(
      heavy.reduce((s, c) => s + barDollarVolume(c), 0),
      6
    );
    expect(context.accelerationRatio).toBeGreaterThan(3);
    expect(context.participation).toBe("accelerating");
  });

  it("needs six bars for two non-overlapping windows, reporting insufficient data below that", () => {
    const five = [571, 572, 573, 574, 575].map((m) => bar(TODAY, m, 100, 101, 100, 100.5, 1000));
    const context = buildDollarVolumeContext(five, [], null, dvConfig);
    expect(context.status).toBe("insufficient_data");
    expect(context.accelerationRatio).toBeNull();
    expect(context.participation).toBe("unavailable");
  });

  it("classifies participation by the configured bands", () => {
    const build = (recentVolume: number) => {
      const older = [571, 572, 573].map((m) => bar(TODAY, m, 100, 101, 100, 100.5, 1000));
      const recent = [574, 575, 576].map((m) =>
        bar(TODAY, m, 100, 101, 100, 100.5, recentVolume)
      );
      return buildDollarVolumeContext([...older, ...recent], [], null, dvConfig);
    };
    expect(build(1300).participation).toBe("accelerating");
    expect(build(1000).participation).toBe("stable");
    expect(build(700).participation).toBe("contracting");
  });

  it("does not imply direction when participation is high but price has not progressed (spec test 9)", () => {
    const older = [571, 572, 573].map((m) => bar(TODAY, m, 100, 100.5, 99.5, 100, 1000));
    // Heavy volume, but the close is exactly where it was three bars ago.
    const recent = [574, 575, 576].map((m) => bar(TODAY, m, 100, 100.5, 99.5, 100, 5000));

    const context = buildDollarVolumeContext([...older, ...recent], [], null, dvConfig);
    expect(context.priceProgression).toBe("flat");
    expect(context.interpretation).toBe("Possible absorption; direction not inferred");
    // Never a claim about who is trading.
    expect(context.interpretation).not.toMatch(/institution|accumulat|distribut|buyer|seller/i);
  });

  it("reads price and participation together for the progressing cases", () => {
    const older = [571, 572, 573].map((m) => bar(TODAY, m, 100, 100.5, 99.5, 100, 2000));
    const strengthening = buildDollarVolumeContext(
      [...older, ...[574, 575, 576].map((m) => bar(TODAY, m, 100, 102, 100, 101.5, 6000))],
      [],
      null,
      dvConfig
    );
    expect(strengthening.priceProgression).toBe("up");
    expect(strengthening.interpretation).toBe("Expansion strengthening upward");

    const weakening = buildDollarVolumeContext(
      [...older, ...[574, 575, 576].map((m) => bar(TODAY, m, 100, 102, 100, 101.5, 500))],
      [],
      null,
      dvConfig
    );
    expect(weakening.interpretation).toBe(
      "Upward expansion continuing, participation weakening"
    );
  });

  // -------------------------------------------------------------------------
  // Finding 4 — every declared interpretation branch must be reachable
  // -------------------------------------------------------------------------

  /**
   * Six bars: three at `olderVolume` closing at `olderClose`, three at
   * `recentVolume` ending at `recentClose`. The acceleration ratio and the
   * price progression are therefore both set independently.
   */
  function context(
    olderVolume: number,
    recentVolume: number,
    olderClose: number,
    recentClose: number,
    baseline: ReturnType<typeof collectTimeOfDayBars> = []
  ) {
    const older = [571, 572, 573].map((m) =>
      bar(TODAY, m, olderClose, olderClose + 0.5, olderClose - 0.5, olderClose, olderVolume)
    );
    const recent = [574, 575].map((m) =>
      bar(TODAY, m, olderClose, olderClose + 0.5, olderClose - 0.5, olderClose, recentVolume)
    );
    const last = bar(
      TODAY,
      576,
      olderClose,
      Math.max(olderClose, recentClose) + 0.5,
      Math.min(olderClose, recentClose) - 0.5,
      recentClose,
      recentVolume
    );
    return buildDollarVolumeContext([...older, ...recent, last], baseline, null, dvConfig);
  }

  it("classifies price progression as up, flat or down rather than a bare boolean", () => {
    expect(context(1000, 1000, 100, 101).priceProgression).toBe("up");
    expect(context(1000, 1000, 100, 100).priceProgression).toBe("flat");
    expect(context(1000, 1000, 100, 99).priceProgression).toBe("down");
    // Sub-tolerance drift is not a direction.
    expect(context(1000, 1000, 100, 100.001).priceProgression).toBe("flat");
    expect(context(1000, 1000, 100, 99.999).priceProgression).toBe("flat");
    // Not enough bars for two windows: unmeasurable, not flat.
    expect(
      buildDollarVolumeContext(
        [571, 572, 573].map((m) => bar(TODAY, m, 100, 101, 99, 100)),
        [],
        null,
        dvConfig
      ).priceProgression
    ).toBe("unavailable");
  });

  it("reaches every declared interpretation branch, naming the direction it measured", () => {
    expect(context(1000, 4000, 100, 102).interpretation).toBe("Expansion strengthening upward");
    expect(context(1000, 4000, 100, 98).interpretation).toBe("Expansion strengthening downward");
    expect(context(4000, 1000, 100, 102).interpretation).toBe(
      "Upward expansion continuing, participation weakening"
    );
    expect(context(4000, 1000, 100, 98).interpretation).toBe(
      "Downward expansion continuing, participation weakening"
    );
    expect(context(1000, 1000, 100, 102).interpretation).toBe("Upward expansion continuing");
    expect(context(1000, 1000, 100, 98).interpretation).toBe("Downward expansion continuing");
    expect(context(1000, 4000, 100, 100).interpretation).toBe(
      "Possible absorption; direction not inferred"
    );
    expect(context(1000, 1000, 100, 100).interpretation).toBe("Participation stable");
  });

  it("never claims reversal pressure it cannot know the direction of", () => {
    // The old wording asserted a reversal without knowing which way the
    // active expansion was running — this function is not given that.
    for (const olderVolume of [500, 1000, 4000]) {
      for (const recentVolume of [500, 1000, 4000]) {
        for (const recentClose of [98, 99.999, 100, 100.001, 102]) {
          const interpretation = context(olderVolume, recentVolume, 100, recentClose).interpretation;
          expect(interpretation).not.toMatch(/reversal/i);
          expect(interpretation).not.toMatch(
            /institution|accumulat|distribut|buyer|seller|likely|expect/i
          );
        }
      }
    }
  });

  it("reaches absorption via a dollar-volume shock even when participation is only stable", () => {
    // The shock branch is the other route into high participation, and it
    // must not be shadowed by the accelerating case above it.
    const shocked = context(1000, 1000, 100, 100, collectTimeOfDayBars(ordinaryBaseline(576, 10), 576, TODAY));
    expect(shocked.participation).toBe("stable");
    expect(shocked.currentBarRelativeDollarVolume).toBeGreaterThan(2);
    expect(shocked.interpretation).toBe("Possible absorption; direction not inferred");
  });

  it("offers no directional interpretation when progression is unmeasurable", () => {
    const tooShort = buildDollarVolumeContext(
      [571, 572, 573].map((m) => bar(TODAY, m, 100, 101, 99, 100)),
      [],
      null,
      dvConfig
    );
    expect(tooShort.priceProgression).toBe("unavailable");
    expect(tooShort.interpretation).toBeNull();
  });

  it("keeps cumulative dollar volume alongside the per-bar figure", () => {
    const bars = [571, 572, 573, 574, 575, 576].map((m) =>
      bar(TODAY, m, 100, 101, 100, 100.5, 1000)
    );
    const context = buildDollarVolumeContext(bars, [], 100_000, dvConfig);
    expect(context.cumulativeDollarVolume).toBeCloseTo(
      bars.reduce((s, c) => s + barDollarVolume(c), 0),
      6
    );
    expect(context.cumulativeRelativeDollarVolume).toBeCloseTo(
      context.cumulativeDollarVolume! / 100_000,
      6
    );
  });
});

// ---------------------------------------------------------------------------
// Section 2 — early acceleration (spec tests 4, 5, 6, 10, 11)
// ---------------------------------------------------------------------------

describe("significant levels", () => {
  const levels = {
    premarketReference: 105,
    frozenPremarketExtreme: 106,
    priorDay: 110,
    openingRange: 107,
    pendingBreakout: 108,
  };

  it("uses the live premarket reference before 9:30 and the frozen extreme after", () => {
    const before = eligibleSignificantLevels(9 * 60, "bullish", levels);
    expect(before.map((l) => l.name)).toContain("premarket_reference_high");
    expect(before.map((l) => l.name)).not.toContain("frozen_premarket_high");
    // The opening range does not exist before the open.
    expect(before.map((l) => l.name)).not.toContain("opening_range_high");

    const after = eligibleSignificantLevels(9 * 60 + 31, "bullish", levels);
    expect(after.map((l) => l.name)).toContain("frozen_premarket_high");
    expect(after.map((l) => l.name)).toContain("opening_range_high");
  });

  it("mirrors the level set for a bearish read", () => {
    const bearish = eligibleSignificantLevels(9 * 60 + 31, "bearish", levels);
    expect(bearish.map((l) => l.name)).toEqual([
      "frozen_premarket_low",
      "prior_day_low",
      "opening_range_low",
      "pending_breakout_level",
    ]);
  });

  it("treats a break as engagement and prefers it over a mere approach", () => {
    const candidates: SignificantLevel[] = [
      { name: "prior_day_high", price: 100 },
      { name: "opening_range_high", price: 101 },
    ];
    const result = findEngagedLevel(100.5, candidates, 1, "bullish", defaultLevelProximityConfig);
    expect(result.engagement).toBe("breaking");
    expect(result.level!.price).toBe(100);
  });

  it("reports no engagement when every level is far away", () => {
    const candidates: SignificantLevel[] = [{ name: "prior_day_high", price: 200 }];
    const result = findEngagedLevel(100, candidates, 0.01, "bullish", defaultLevelProximityConfig);
    expect(result.engagement).toBe("none");
  });
});

describe("early acceleration", () => {
  const baseline = collectTimeOfDayBars(ordinaryBaseline(571, 1000, 100.2, 100), 571, TODAY);
  const levels: SignificantLevel[] = [{ name: "prior_day_high", price: 101 }];

  function buildInput(overrides: Partial<EarlyAccelerationInput> = {}): EarlyAccelerationInput {
    return {
      symbol: "GOOGL",
      direction: "bullish",
      completedOneMinuteBars: [
        bar(TODAY, 570, 100, 100.1, 99.9, 100, 1000),
        bar(TODAY, 571, 100, 101.6, 100, 101.5, 8000),
      ],
      timeOfDayBaseline: baseline,
      significantLevels: levels,
      dailyAtr: 1,
      freshness: "real_time",
      freshnessPermitsAlerting: true,
      ...overrides,
    };
  }

  it("fires on a bullish one-minute acceleration (spec test 4)", () => {
    const result = detectEarlyAcceleration(buildInput(), dvConfig);
    expect(result.fired).toBe(true);
    expect(result.blockedBy).toBeNull();
    expect(result.checks.dollarVolumeShock.passed).toBe(true);
    expect(result.checks.trueRangeShock.passed).toBe(true);
    expect(result.checks.closeNearExtreme).toBe(true);
    expect(result.checks.level.engagement).toBe("breaking");
  });

  it("fires on the mirrored bearish acceleration (spec test 5)", () => {
    const result = detectEarlyAcceleration(
      buildInput({
        direction: "bearish",
        completedOneMinuteBars: [
          bar(TODAY, 570, 100, 100.1, 99.9, 100, 1000),
          bar(TODAY, 571, 100, 100, 98.4, 98.5, 8000),
        ],
        significantLevels: [{ name: "prior_day_low", price: 99 }],
      }),
      dvConfig
    );
    expect(result.fired).toBe(true);
    expect(result.direction).toBe("bearish");
  });

  it("ignores an unfinished one-minute candle (spec test 6)", () => {
    // The caller passes completed bars only; with none, there is nothing
    // to evaluate and the alert must not fire.
    const result = detectEarlyAcceleration(
      buildInput({ completedOneMinuteBars: [] }),
      dvConfig
    );
    expect(result.fired).toBe(false);
    expect(result.blockedBy).toBe("No completed 1-minute candle");
    expect(result.barTime).toBeNull();
  });

  it("is always labeled unconfirmed and Monitor priority (spec test 10)", () => {
    const result = detectEarlyAcceleration(buildInput(), dvConfig);
    expect(result.label).toBe("EARLY HEADS-UP · UNCONFIRMED");
    expect(result.label).toBe(EARLY_ALERT_LABEL);
    expect(result.priority).toBe(EARLY_ALERT_PRIORITY);
    expect(result.priority).toBe("monitor");
    expect(result.type).toBe("early_acceleration");
  });

  it("requires every gate — any one missing blocks the alert", () => {
    // No dollar-volume shock.
    expect(
      detectEarlyAcceleration(
        buildInput({
          completedOneMinuteBars: [
            bar(TODAY, 570, 100, 100.1, 99.9, 100, 1000),
            bar(TODAY, 571, 100, 101.6, 100, 101.5, 900),
          ],
        }),
        dvConfig
      ).blockedBy
    ).toBe("No dollar-volume shock");

    // Volume and range shock, but a weak close.
    expect(
      detectEarlyAcceleration(
        buildInput({
          completedOneMinuteBars: [
            bar(TODAY, 570, 100, 100.1, 99.9, 100, 1000),
            bar(TODAY, 571, 101.5, 101.6, 100, 100.1, 8000),
          ],
        }),
        dvConfig
      ).blockedBy
    ).toBe("Candle did not close near its extreme");

    // Everything fires but no significant level is nearby.
    expect(
      detectEarlyAcceleration(
        buildInput({ significantLevels: [{ name: "prior_day_high", price: 500 }] }),
        dvConfig
      ).blockedBy
    ).toBe("Not near a significant level");

    // Freshness blocks alerting.
    expect(
      detectEarlyAcceleration(
        buildInput({ freshness: "stale", freshnessPermitsAlerting: false }),
        dvConfig
      ).blockedBy
    ).toBe("Freshness does not permit alerting");
  });

  it("blocks rather than guesses when the baseline is unavailable", () => {
    const result = detectEarlyAcceleration(buildInput({ timeOfDayBaseline: [] }), dvConfig);
    expect(result.fired).toBe(false);
    expect(result.blockedBy).toBe("Dollar-volume baseline unavailable");
  });
});

// ---------------------------------------------------------------------------
// Hardening B — a genuinely unfinished one-minute candle, through the real path
// ---------------------------------------------------------------------------

describe("a still-forming one-minute candle is excluded at the cutoff layer", () => {
  const baseline = collectTimeOfDayBars(ordinaryBaseline(571, 1000, 100.2, 100), 571, TODAY);

  /** Four quiet completed minutes, then a violent bar that has NOT closed. */
  const completed = [568, 569, 570].map((m) => bar(TODAY, m, 100, 100.1, 99.9, 100, 1000));
  const forming = bar(TODAY, 571, 100, 108, 99, 107.9, 250_000);
  const allBars = [...completed, forming];

  /** 9:31:40 ET — the 9:31 bar is 40 seconds into its minute. */
  const DURING = new Date(Date.parse(`${TODAY}T13:31:40Z`));
  /** 9:32:10 ET — the 9:31 bar has closed. */
  const AFTER = new Date(Date.parse(`${TODAY}T13:32:10Z`));

  it("does not include the forming bar in the completed set", () => {
    expect(computeCompletedBarCutoff(allBars, 1, DURING)).toBe(9 * 60 + 31);
    const usable = filterToCompletedBars(allBars, 1, DURING);
    expect(usable.map((c) => c.time)).toEqual(completed.map((c) => c.time));
    expect(usable).not.toContainEqual(forming);
  });

  it("cannot produce an early acceleration off the forming bar", () => {
    // Fed through the real cutoff filter, the extreme bar is simply not
    // there, so the last completed candle is an ordinary quiet one.
    const result = detectEarlyAcceleration(
      {
        symbol: "GOOGL",
        direction: "bullish",
        completedOneMinuteBars: filterToCompletedBars(allBars, 1, DURING),
        timeOfDayBaseline: collectTimeOfDayBars(ordinaryBaseline(570, 1000, 100.2, 100), 570, TODAY),
        significantLevels: [{ name: "prior_day_high", price: 101 }],
        dailyAtr: 1,
        freshness: "real_time",
        freshnessPermitsAlerting: true,
      },
      dvConfig
    );
    expect(result.fired).toBe(false);
    expect(result.blockedBy).toBe("No dollar-volume shock");
    expect(result.barTime).toBe(completed[completed.length - 1].time);
  });

  it("cannot move the reference high or low", () => {
    const usable = filterToCompletedBars(allBars, 1, DURING);
    expect(Math.max(...usable.map((c) => c.high))).toBe(100.1);
    expect(Math.min(...usable.map((c) => c.low))).toBe(99.9);
    // The forming bar's 108 high and 99 low are nowhere in the range.
    expect(Math.max(...usable.map((c) => c.high))).toBeLessThan(forming.high);
  });

  it("cannot alter the dollar-volume shock", () => {
    const usable = filterToCompletedBars(allBars, 1, DURING);
    const quietShock = measureDollarVolumeShock(usable[usable.length - 1], baseline, dvConfig);
    expect(quietShock.passed).toBe(false);
    // The same measurement taken on the forming bar would have been a
    // 200x shock — which is what makes excluding it load-bearing.
    const ifItHadCounted = measureDollarVolumeShock(forming, baseline, dvConfig);
    expect(ifItHadCounted.multiple!).toBeGreaterThan(100);
  });

  it("becomes eligible the moment it actually closes", () => {
    expect(computeCompletedBarCutoff(allBars, 1, AFTER)).toBe(9 * 60 + 32);
    const usable = filterToCompletedBars(allBars, 1, AFTER);
    expect(usable).toContainEqual(forming);

    const result = detectEarlyAcceleration(
      {
        symbol: "GOOGL",
        direction: "bullish",
        completedOneMinuteBars: usable,
        timeOfDayBaseline: baseline,
        significantLevels: [{ name: "prior_day_high", price: 101 }],
        dailyAtr: 1,
        freshness: "real_time",
        freshnessPermitsAlerting: true,
      },
      dvConfig
    );
    expect(result.fired).toBe(true);
    expect(result.barTime).toBe(forming.time);
  });

  it("reports nothing usable rather than the forming bar when none has closed yet", () => {
    const justOpened = new Date(Date.parse(`${TODAY}T13:31:10Z`));
    expect(filterToCompletedBars([forming], 1, justOpened)).toEqual([]);
    expect(computeCompletedBarCutoff([forming], 1, justOpened)).toBeNull();
  });
});

describe("early alert deduplication (spec test 11)", () => {
  const level: SignificantLevel = { name: "prior_day_high", price: 100 };
  const key = {
    userId: "user-1",
    symbol: "GOOGL",
    direction: "bullish" as const,
    tradingDate: TODAY,
    level,
  };

  it("fires once per user + symbol + direction + trading date + level", () => {
    const dedup = new EarlyAlertDeduplicator();
    expect(dedup.shouldFire(key)).toBe(true);
    dedup.record(key);
    expect(dedup.shouldFire(key)).toBe(false);
  });

  it("does not alert again on every accelerated candle at the same level", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    for (let minute = 1; minute <= 10; minute++) {
      expect(dedup.shouldFire(key, minute * 60_000)).toBe(false);
    }
  });

  it("treats a nearby level price as the same zone, not a new attempt", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    // A level recomputed each scan drifts slightly; that must not defeat
    // deduplication.
    const drifted = { ...key, level: { ...level, price: 100.05 } };
    expect(dedup.shouldFire(drifted, 60_000)).toBe(false);
  });

  it("allows a new attempt at a genuinely different level only after invalidation", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);

    const higher = { ...key, level: { name: "opening_range_high" as const, price: 110 } };
    // Still one continuous move — grinding up through levels is not
    // several independent setups.
    expect(dedup.shouldFire(higher, 60_000)).toBe(false);

    dedup.markInvalidated({
      userId: key.userId,
      symbol: key.symbol,
      direction: key.direction,
      tradingDate: key.tradingDate,
    });
    expect(dedup.shouldFire(higher, 120_000)).toBe(true);
  });

  it("allows another alert after the configured reset period", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    const justBefore = (defaultDeduplicationConfig.resetPeriodSeconds - 1) * 1000;
    expect(dedup.shouldFire(key, justBefore)).toBe(false);
    expect(dedup.shouldFire(key, defaultDeduplicationConfig.resetPeriodSeconds * 1000)).toBe(true);
  });

  it("keys on the Eastern trading date, so a new session alerts again", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    expect(dedup.shouldFire({ ...key, tradingDate: "2026-07-14" }, 60_000)).toBe(true);
  });

  it("separates users, symbols and directions", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    expect(dedup.shouldFire({ ...key, userId: "user-2" }, 0)).toBe(true);
    expect(dedup.shouldFire({ ...key, symbol: "MSFT" }, 0)).toBe(true);
    expect(dedup.shouldFire({ ...key, direction: "bearish" }, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Findings 5 and 6 — reset behavior and per-zone level identity
// ---------------------------------------------------------------------------

describe("early alert reset behavior (finding 5)", () => {
  const level: SignificantLevel = { name: "prior_day_high", price: 100 };
  const key = {
    userId: "user-1",
    symbol: "GOOGL",
    direction: "bullish" as const,
    tradingDate: TODAY,
    level,
  };
  const RESET_MS = defaultDeduplicationConfig.resetPeriodSeconds * 1000;
  const other = { ...key, level: { name: "opening_range_high" as const, price: 130 } };

  it("permits a different structural level once the first setup invalidated", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    dedup.markInvalidated(baseOf(key));
    expect(dedup.shouldFire(other, 60_000)).toBe(true);
  });

  it("permits a different structural level once the reset period has elapsed", () => {
    // The old rule returned `record.invalidated` alone here, which
    // permanently suppressed a legitimate later attempt at a different
    // level whenever the earlier one simply faded rather than invalidating.
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    expect(dedup.shouldFire(other, RESET_MS)).toBe(true);
  });

  it("suppresses a different structural level when neither has happened", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    expect(dedup.shouldFire(other, RESET_MS - 1)).toBe(false);
  });

  it("does not re-alert an unchanged, continuously-qualifying signal at reset time", () => {
    // Cooldown expiry alone is not new information. The signal has been
    // true without interruption since it first fired; re-alerting on it
    // reports the passage of time as a market event.
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    expect(dedup.shouldFire(key, RESET_MS, { qualifyingSince: 0 })).toBe(false);
    expect(dedup.shouldFire(key, RESET_MS * 3, { qualifyingSince: 0 })).toBe(false);
  });

  it("re-alerts at the same level after a fresh non-qualifying to qualifying transition", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    // The signal dropped out and re-formed well after the original alert.
    expect(dedup.shouldFire(key, RESET_MS, { qualifyingSince: RESET_MS - 60_000 })).toBe(true);
    // ...but not before the reset period, however fresh the transition.
    expect(dedup.shouldFire(key, 60_000, { qualifyingSince: 59_000 })).toBe(false);
  });

  it("lets an invalidated setup form a genuinely new attempt", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    dedup.markInvalidated(baseOf(key));
    expect(dedup.shouldFire(other, 60_000)).toBe(true);
    dedup.record(other, 60_000);
    // The new attempt is now itself deduplicated.
    expect(dedup.shouldFire(other, 120_000)).toBe(false);
  });
});

describe("early alert level identity (finding 6)", () => {
  const key = {
    userId: "user-1",
    symbol: "GOOGL",
    direction: "bullish" as const,
    tradingDate: TODAY,
    level: { name: "prior_day_high" as const, price: 100 },
  };
  const RESET_MS = defaultDeduplicationConfig.resetPeriodSeconds * 1000;

  it("gives a level a stable identity of kind plus zone, never a raw float", () => {
    const identity = structuralLevelIdentity(key.level, defaultDeduplicationConfig);
    expect(identity.kind).toBe("prior_day_high");
    expect(identity.zoneId).not.toContain("100.0000");
    expect(typeof identity.zoneId).toBe("string");
    // The identity is reproducible for the same input.
    expect(structuralLevelIdentity(key.level, defaultDeduplicationConfig)).toEqual(identity);
  });

  it("treats a tiny float difference as the same zone", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    expect(dedup.shouldFire({ ...key, level: { ...key.level, price: 100.0000001 } }, 60_000)).toBe(
      false
    );
    expect(dedup.shouldFire({ ...key, level: { ...key.level, price: 99.9999999 } }, 60_000)).toBe(
      false
    );
  });

  it("merges a premarket high and a prior-day high at the same price into one zone", () => {
    // Two names for what is, structurally, one level. Alerting twice on it
    // is the same duplicate the zone exists to prevent.
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    const premarketHigh = {
      ...key,
      level: { name: "premarket_reference_high" as const, price: 100.05 },
    };
    expect(dedup.shouldFire(premarketHigh, 60_000)).toBe(false);
  });

  it("does not re-fire at a level already alerted on earlier the same day", () => {
    // fire@A, invalidate, fire@B, then price returns to A. A already
    // alerted today; coming back to it is not a new attempt on its own.
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    dedup.markInvalidated(baseOf(key));

    const levelB = { ...key, level: { name: "opening_range_high" as const, price: 130 } };
    expect(dedup.shouldFire(levelB, 60_000)).toBe(true);
    dedup.record(levelB, 60_000);

    // Back to A, well inside its own reset period.
    expect(dedup.shouldFire(key, 120_000)).toBe(false);
  });

  it("still re-fires at an earlier level once its own reset period has passed", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    const levelB = { ...key, level: { name: "opening_range_high" as const, price: 130 } };
    dedup.record(levelB, 60_000);
    expect(dedup.shouldFire(key, RESET_MS + 1)).toBe(true);
  });

  it("does not re-fire while price grinds through nearby levels in one continuous move", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    // Each level is structurally distinct, but nothing invalidated and no
    // reset period elapsed — this is one move, not four setups.
    for (const [i, price] of [101, 103, 106, 110].entries()) {
      expect(
        dedup.shouldFire({ ...key, level: { ...key.level, price } }, (i + 1) * 60_000)
      ).toBe(false);
    }
  });

  it("keeps zones separate per direction, user and Eastern trading date", () => {
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    expect(dedup.shouldFire({ ...key, direction: "bearish" }, 0)).toBe(true);
    expect(dedup.shouldFire({ ...key, userId: "user-2" }, 0)).toBe(true);
    expect(dedup.shouldFire({ ...key, tradingDate: "2026-07-14" }, 0)).toBe(true);
  });

  it("keeps each zone anchored where it first fired, so drift cannot walk it", () => {
    // Repeated near-tolerance drift must not ratchet a zone's anchor
    // upward until it has silently become a different level.
    const dedup = new EarlyAlertDeduplicator();
    dedup.record(key, 0);
    for (const price of [100.15, 100.3, 100.45]) {
      dedup.record({ ...key, level: { ...key.level, price } }, 60_000);
    }
    // 100.15 is inside 100's zone. 100.3 is outside it, so it opens a
    // second zone, which 100.45 then joins. An implementation that moved
    // each anchor to the latest price would report a single walked zone.
    expect(dedup.zoneAnchors(baseOf(key))).toEqual([100, 100.3]);
  });
});

// ---------------------------------------------------------------------------
// Integration fixtures (spec tests 12, 13, 14, 15, 16)
// ---------------------------------------------------------------------------

describe("GOOGL-style expansion fixture", () => {
  const config = defaultStrategyConfig.premarketExpansion;
  const baseline = collectTimeOfDayBars(ordinaryBaseline(571, 1000, 100.2, 100), 571, TODAY);

  /** A one-minute acceleration through the prior-day high at 9:31. */
  const acceleration = [
    bar(TODAY, 570, 100, 100.1, 99.9, 100, 1000),
    bar(TODAY, 571, 100, 101.6, 100, 101.5, 8000),
  ];

  it("triggers an early acceleration before five-minute acceptance exists (spec test 13)", () => {
    const early = detectEarlyAcceleration(
      {
        symbol: "GOOGL",
        direction: "bullish",
        completedOneMinuteBars: acceleration,
        timeOfDayBaseline: baseline,
        significantLevels: [{ name: "prior_day_high", price: 101 }],
        dailyAtr: 1,
        freshness: "real_time",
        freshnessPermitsAlerting: true,
      },
      dvConfig
    );
    expect(early.fired).toBe(true);

    // At the same moment the 5m series holds only ONE completed close
    // beyond the level, which is explicitly not acceptance.
    const candidate = detectPremarketExpansion(
      {
        symbol: "GOOGL",
        direction: "bullish",
        premarketCandles: [
          bar(TODAY, 545, 99, 100, 98.5, 99.5),
          bar(TODAY, 550, 99.5, 100.5, 99, 100),
          bar(TODAY, 555, 100, 100.8, 99.8, 100.5),
          bar(TODAY, 560, 100.5, 101.6, 100.4, 101.5),
        ],
        confirmationCandles: [bar(TODAY, 560, 100.5, 101.6, 100.4, 101.5)],
        dailyCandles: [
          {
            time: Math.floor(Date.parse("2026-07-10T20:00:00Z") / 1000),
            open: 100,
            high: 101,
            low: 98,
            close: 100,
            volume: 1_000_000,
          },
        ],
        todayTradingDate: TODAY,
        todaySession: null,
        baseline: [],
        elapsedPremarketMinutes: 320,
        dailyAtr: 1,
        benchmarkSymbol: "QQQ",
        benchmarkPremarketCandles: [],
        benchmarkDailyCandles: [],
        feed: { delayed: false, knownDelayMinutes: null },
        datasetIncomplete: false,
        candleIntervalMinutes: 5,
        scannedAt: new Date((etTime(TODAY, 560) + 5 * 60 + 60) * 1000),
      },
      config
    );
    expect(candidate.confirmation.state).toBe("awaiting_acceptance");
    expect(candidate.stage).not.toBe("breakout_accepted");
  });

  it("later produces breakout acceptance on the same fixture (spec test 14)", () => {
    const candidate = detectPremarketExpansion(
      {
        symbol: "GOOGL",
        direction: "bullish",
        premarketCandles: [
          bar(TODAY, 545, 99, 100, 98.5, 99.5),
          bar(TODAY, 550, 99.5, 100.5, 99, 100),
          bar(TODAY, 555, 100, 100.8, 99.8, 100.5),
          bar(TODAY, 565, 101.5, 102.5, 101.4, 102.2),
        ],
        // Two completed closes beyond the level.
        confirmationCandles: [
          bar(TODAY, 560, 100.5, 101.6, 100.4, 101.5),
          bar(TODAY, 565, 101.5, 102.5, 101.4, 102.2),
        ],
        dailyCandles: [
          {
            time: Math.floor(Date.parse("2026-07-10T20:00:00Z") / 1000),
            open: 100,
            high: 101,
            low: 98,
            close: 100,
            volume: 1_000_000,
          },
        ],
        todayTradingDate: TODAY,
        todaySession: null,
        baseline: [],
        elapsedPremarketMinutes: 320,
        dailyAtr: 1,
        benchmarkSymbol: "QQQ",
        benchmarkPremarketCandles: [],
        benchmarkDailyCandles: [],
        feed: { delayed: false, knownDelayMinutes: null },
        datasetIncomplete: false,
        candleIntervalMinutes: 5,
        scannedAt: new Date((etTime(TODAY, 565) + 5 * 60 + 60) * 1000),
      },
      config
    );
    expect(candidate.confirmation.state).toBe("accepted");
    expect(candidate.stage).toBe("breakout_accepted");
  });

  it("gives a failed look-alike an early alert but never acceptance (spec test 15)", () => {
    // Same one-minute acceleration...
    const early = detectEarlyAcceleration(
      {
        symbol: "FAKE",
        direction: "bullish",
        completedOneMinuteBars: acceleration,
        timeOfDayBaseline: baseline,
        significantLevels: [{ name: "prior_day_high", price: 101 }],
        dailyAtr: 1,
        freshness: "real_time",
        freshnessPermitsAlerting: true,
      },
      dvConfig
    );
    expect(early.fired).toBe(true);
    expect(early.label).toBe(EARLY_ALERT_LABEL);

    // ...but the 5m series fails back below the level and never accepts.
    const candidate = detectPremarketExpansion(
      {
        symbol: "FAKE",
        direction: "bullish",
        premarketCandles: [
          bar(TODAY, 545, 99, 100, 98.5, 99.5),
          bar(TODAY, 550, 99.5, 100.5, 99, 100),
          bar(TODAY, 555, 100, 100.8, 99.8, 100.5),
          bar(TODAY, 565, 101.5, 101.6, 99.5, 99.8),
        ],
        confirmationCandles: [
          bar(TODAY, 560, 100.5, 101.6, 100.4, 101.5),
          bar(TODAY, 565, 101.5, 101.6, 99.5, 99.8), // closed back below
        ],
        dailyCandles: [
          {
            time: Math.floor(Date.parse("2026-07-10T20:00:00Z") / 1000),
            open: 100,
            high: 101,
            low: 98,
            close: 100,
            volume: 1_000_000,
          },
        ],
        todayTradingDate: TODAY,
        todaySession: null,
        baseline: [],
        elapsedPremarketMinutes: 320,
        dailyAtr: 1,
        benchmarkSymbol: "QQQ",
        benchmarkPremarketCandles: [],
        benchmarkDailyCandles: [],
        feed: { delayed: false, knownDelayMinutes: null },
        datasetIncomplete: false,
        candleIntervalMinutes: 5,
        scannedAt: new Date((etTime(TODAY, 565) + 5 * 60 + 60) * 1000),
      },
      config
    );
    expect(candidate.confirmation.state).not.toBe("accepted");
    expect(candidate.stage).not.toBe("breakout_accepted");
  });

  it("mirrors the whole fixture for a bearish breakdown (spec test 16)", () => {
    const candidate = detectPremarketExpansion(
      {
        symbol: "GOOGL",
        direction: "bearish",
        premarketCandles: [
          bar(TODAY, 545, 101, 101.5, 100, 100.5),
          bar(TODAY, 550, 100.5, 101, 99.5, 100),
          bar(TODAY, 555, 100, 100.2, 99.2, 99.5),
          bar(TODAY, 565, 98.5, 98.6, 97.4, 97.5),
        ],
        confirmationCandles: [
          bar(TODAY, 560, 99.5, 99.6, 98.4, 98.5),
          bar(TODAY, 565, 98.5, 98.6, 97.4, 97.5),
        ],
        dailyCandles: [
          {
            time: Math.floor(Date.parse("2026-07-10T20:00:00Z") / 1000),
            open: 100,
            high: 102,
            low: 99,
            close: 100,
            volume: 1_000_000,
          },
        ],
        todayTradingDate: TODAY,
        todaySession: null,
        baseline: [],
        elapsedPremarketMinutes: 320,
        dailyAtr: 1,
        benchmarkSymbol: "QQQ",
        benchmarkPremarketCandles: [],
        benchmarkDailyCandles: [],
        feed: { delayed: false, knownDelayMinutes: null },
        datasetIncomplete: false,
        candleIntervalMinutes: 5,
        scannedAt: new Date((etTime(TODAY, 565) + 5 * 60 + 60) * 1000),
      },
      config
    );
    expect(candidate.direction).toBe("bearish");
    expect(candidate.confirmation.state).toBe("accepted");
    expect(candidate.stage).toBe("breakout_accepted");
  });
});

/**
 * Every module the Expansion Monitor added. Centralized so a new one
 * cannot be introduced without either appearing in this list or failing
 * the directory check below — the previous version enumerated three of
 * them inline and silently stopped covering the rest.
 */
const EXPANSION_MODULES = [
  "premarketExpansion",
  "premarketExpansionDisplay",
  "earlyAcceleration",
  "expansionPriority",
  "expansionPresentation",
  "expansionMonitor",
  "dollarVolume",
  "historicalBaseline",
] as const;

describe("the original scanner is untouched (spec test 12)", () => {
  const scorerSource = readFileSync(resolve(__dirname, "../lib/strategies/scorer.ts"), "utf8");

  it("lists every expansion module that exists, so the guard cannot fall behind", () => {
    // The expansion modules live in exactly two places. If a new one is
    // added and not listed above, this fails rather than quietly leaving
    // it unguarded.
    const onDisk = [
      ...readdirSync(resolve(__dirname, "../lib/indicators")),
      ...readdirSync(resolve(__dirname, "../lib/scanner")),
      ...readdirSync(resolve(__dirname, "../lib/market-data")),
    ]
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""));

    for (const moduleName of EXPANSION_MODULES) {
      expect(onDisk).toContain(moduleName);
    }

    // Any module whose name announces it belongs to this feature must be
    // in the list.
    const expansionNamed = onDisk.filter((f) =>
      /^(expansion|premarketExpansion|earlyAcceleration|dollarVolume)/.test(f)
    );
    for (const moduleName of expansionNamed) {
      expect(EXPANSION_MODULES as readonly string[]).toContain(moduleName);
    }
  });

  it("imports none of the expansion modules into the scorer", () => {
    for (const moduleName of EXPANSION_MODULES) {
      expect(scorerSource).not.toContain(moduleName);
    }
  });

  it("leaves priorDayContinuation as the original implementation", () => {
    // The spec says not to replace it until its consumers are deliberately
    // migrated, which is not part of this pass.
    const source = readFileSync(
      resolve(__dirname, "../lib/indicators/priorDayContinuation.ts"),
      "utf8"
    );
    for (const moduleName of EXPANSION_MODULES) {
      expect(source).not.toContain(moduleName);
    }
    expect(scorerSource).toContain("priorDayContinuation");
  });

  /**
   * scanService is the SANCTIONED integration seam — Feature A wires the
   * expansion candidate in there deliberately, so it may import these
   * modules. The scorer is not a seam: the expansion candidate is a
   * separate setup type and must never reach the reversal checklist,
   * which is what the assertions above and below actually protect.
   */
  it("permits scanService to import the expansion modules, unlike the scorer", () => {
    const scanService = readFileSync(
      resolve(__dirname, "../lib/scanner/scanService.ts"),
      "utf8"
    );
    // The seam is real, not theoretical: the detector is genuinely wired in.
    expect(scanService).toContain("detectPremarketExpansion");
    expect(scanService).toContain("premarketExpansion");

    // ...and that changes nothing about the scorer's isolation.
    for (const moduleName of EXPANSION_MODULES) {
      expect(scorerSource).not.toContain(moduleName);
    }
  });

  it("keeps the expansion candidate out of the reversal checklist entirely", () => {
    // Integration means scanService CALLS the detector alongside
    // scoreSetup; nothing expansion-shaped may reach the scorer's input
    // or the reversal result type.
    const setupTypes = readFileSync(resolve(__dirname, "../types/setup.ts"), "utf8");
    expect(setupTypes).not.toMatch(/expansion/i);
    expect(scorerSource).not.toMatch(/expansion/i);
  });

  it("adds no condition to, and removes none from, the existing checklist", () => {
    // The expansion feature is a separate setup type evaluated
    // independently — it must not appear in the reversal checklist, and
    // priorDayContinuation must still be there. (The spec says not to
    // replace priorDayContinuation until its consumers are deliberately
    // migrated, which is not part of this pass.)
    const source = readFileSync(
      resolve(__dirname, "../lib/strategies/scorer.ts"),
      "utf8"
    );
    const ids = [...source.matchAll(/^\s*id: "([a-z_]+)",$/gm)].map((m) => m[1]);

    expect(ids).toEqual([
      "intraday_decline",
      "recovery_from_low",
      "consecutive_bullish",
      "liquidity_sweep",
      "structure_shift",
      "ema_reclaim",
      "fair_value_gap",
      "gap_proximity",
      "prior_day_continuation",
      "momentum_ladder",
      "benchmark_alignment",
      "volume_confirmation",
      "daily_sma_confirmation",
      "strat_confirmation",
      "vwap_reclaim",
    ]);
    expect(ids).toContain("prior_day_continuation");
    expect(ids).not.toContain("premarket_expansion");
    expect(ids).not.toContain("early_acceleration");
  });

});
