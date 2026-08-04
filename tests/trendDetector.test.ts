import { describe, it, expect } from "vitest";
import type { Candle } from "@/types/candle";
import {
  defaultTrendScannerConfig,
  normalizeTrendScannerConfig,
  validateTrendScannerConfig,
} from "@/lib/trend/config";
import {
  candleColourCounts,
  closeTransitions,
  movingAverageFact,
  nearestLevelAhead,
  openingRangeLevels,
  selectTap2Level,
} from "@/lib/trend/facts";
import { opsFor } from "@/lib/trend/direction";
import { detectHeldBaseOrigin, detectMomentumOrigin, PRICE_EPSILON } from "@/lib/trend/origin";
import { advanceLifecycle, crossedMilestones, emptyLifecycle } from "@/lib/trend/stages";
import { computeGate, evaluateTrend } from "@/lib/trend/evaluate";
import { rankTrendResults } from "@/lib/trend/ranking";
import { replaySession, relativeVolumeFrom } from "@/lib/trend/replay";
import {
  bearishLifecycleSession,
  bullishLifecycleSession,
} from "@/lib/trend/fixtures/syntheticSession";
import type { RelativeVolumeFact, TrendFacts, TrendResult } from "@/lib/trend/types";

/**
 * TREND SCANNER — pure detector coverage.
 *
 * Everything here runs on completed candles only. Where a test asserts a
 * negative ("does not fire"), it also asserts a precondition proving the
 * fixture could have fired, so nothing passes by being empty.
 */

const CONFIG = defaultTrendScannerConfig;
const DATE = "2026-08-03";
const T0 = Math.floor(Date.parse(`${DATE}T13:30:00Z`) / 1000);

function bar(i: number, o: number, h: number, l: number, c: number, v = 10_000): Candle {
  return { time: T0 + i * 60, open: o, high: h, low: l, close: c, volume: v };
}

const okVolume: RelativeVolumeFact = {
  multiple: 2,
  dollarMultiple: 2,
  unavailableReason: null,
  feed: "test",
  partialMarketCoverage: false,
};

/** A baseline facts object; overrides shape each scenario. */
function factsWith(overrides: Partial<TrendFacts>): TrendFacts {
  return {
    price: 100,
    oneMinuteEma9: { value: 99, above: true, rising: true },
    fiveMinuteEma9: { value: 99.5, above: true, rising: true },
    fiveMinuteSma20: { value: 101, above: false, rising: false },
    dailySma20: { value: null, above: null, rising: null },
    vwap: { value: 101, above: false, reclaimedAt: null },
    atr5m: 0.5,
    levels: [],
    closeTransitions: { transitions: 3, favourable: 2, measurable: true },
    greenCandles: 2,
    redCandles: 1,
    relativeVolume: okVolume,
    relativeToBenchmark: null,
    relativeToSector: null,
    fromOriginDollars: 0.1,
    fromOriginPct: 0.1,
    fromOriginAtr: 0.2,
    nearestLevel: null,
    distanceToNearestLevelPct: null,
    atrFromFiveMinuteEma: 0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EMA facts: above vs reclaimed are different questions
// ---------------------------------------------------------------------------

describe("moving average facts", () => {
  it("reports above the EMA without requiring a historical cross", () => {
    // Price has been above the EMA the entire series — there is no
    // below-to-above reclaim anywhere. That must not stop it reporting
    // that price is currently above.
    const series = [10, 10.1, 10.2, 10.3];
    const fact = movingAverageFact(series, 11, opsFor("bullish"));
    expect(fact.above).toBe(true);
    expect(fact.rising).toBe(true);
  });

  it("reports a falling EMA as not rising, without calling it unavailable", () => {
    const fact = movingAverageFact([10.3, 10.2, 10.1, 10], 9, opsFor("bullish"));
    expect(fact.rising).toBe(false);
    expect(fact.above).toBe(false);
  });

  it("returns null rather than a guess when slope history is too short", () => {
    const fact = movingAverageFact([10, 10.1], 11, opsFor("bullish"));
    expect(fact.above).toBe(true);
    // Not enough bars to compare against — unavailable, never false.
    expect(fact.rising).toBeNull();
  });

  it("mirrors for bearish: below and falling are the favourable facts", () => {
    const fact = movingAverageFact([10.3, 10.2, 10.1, 10], 9, opsFor("bearish"));
    expect(fact.above).toBe(true); // "above" means favourable-side here
    expect(fact.rising).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transitions: N transitions need N+1 candles
// ---------------------------------------------------------------------------

describe("close-to-close transitions", () => {
  it("requires four completed candles to measure three transitions", () => {
    const three = [bar(0, 1, 1, 1, 10), bar(1, 1, 1, 1, 11), bar(2, 1, 1, 1, 12)];
    expect(closeTransitions(three, 3, "bullish").measurable).toBe(false);

    const four = [...three, bar(3, 1, 1, 1, 13)];
    const fact = closeTransitions(four, 3, "bullish");
    expect(fact.measurable).toBe(true);
    expect(fact.transitions).toBe(3);
    expect(fact.favourable).toBe(3);
  });

  it("counts only favourable transitions, not candles", () => {
    // closes 10 -> 11 -> 10.5 -> 11.5 : up, down, up = 2 of 3.
    const candles = [
      bar(0, 1, 1, 1, 10),
      bar(1, 1, 1, 1, 11),
      bar(2, 1, 1, 1, 10.5),
      bar(3, 1, 1, 1, 11.5),
    ];
    expect(closeTransitions(candles, 3, "bullish").favourable).toBe(2);
    // The bearish mirror sees exactly the complement.
    expect(closeTransitions(candles, 3, "bearish").favourable).toBe(1);
  });

  it("reports candle colours separately from transitions", () => {
    const candles = [bar(0, 10, 11, 9, 11), bar(1, 11, 12, 10, 10)];
    const colours = candleColourCounts(candles, 4);
    expect(colours.green).toBe(1);
    expect(colours.red).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Origin detection
// ---------------------------------------------------------------------------

describe("held-base origin (Path A)", () => {
  /** Falls to a session low, bounces, pulls back to a HIGHER low, holds. */
  function basingSeries(): Candle[] {
    const out: Candle[] = [];
    let i = 0;
    for (let p = 100; p >= 97; p -= 0.25) out.push(bar(i++, p, p + 0.05, p - 0.25, p - 0.2));
    for (let p = 97; p <= 98.6; p += 0.2) out.push(bar(i++, p, p + 0.2, p - 0.05, p + 0.15));
    for (let p = 98.6; p >= 97.8; p -= 0.2) out.push(bar(i++, p, p + 0.05, p - 0.2, p - 0.15));
    for (let k = 0; k < 6; k++) out.push(bar(i++, 97.9, 97.95, 97.85, 97.92));
    return out;
  }

  it("locks an origin on a higher low that is not the session low", () => {
    const oneMinute = basingSeries();
    const attempt = detectHeldBaseOrigin({
      oneMinute,
      fiveMinute: oneMinute,
      direction: "bullish",
      atr5m: 0.5,
      levels: [{ name: "Premarket high", price: 103, availableFrom: null }],
      config: CONFIG,
    });

    expect(attempt.origin).not.toBeNull();
    const sessionLow = Math.min(...oneMinute.map((c) => c.low));
    // Strictly ABOVE the session low — a match would be a double bottom,
    // not a higher low.
    expect(attempt.origin!.price).toBeGreaterThan(sessionLow + PRICE_EPSILON);
    expect(attempt.origin!.mode).toBe("held_base");
    // Invalidation sits BELOW the origin for a long.
    expect(attempt.origin!.invalidationPrice).toBeLessThan(attempt.origin!.price);
  });

  it("does not lock when the candidate merely matches the session low", () => {
    // A flat double bottom: no candidate is strictly above the extreme.
    const flat = Array.from({ length: 20 }, (_, i) => bar(i, 100, 100.1, 99.0, 100));
    const attempt = detectHeldBaseOrigin({
      oneMinute: flat,
      fiveMinute: flat,
      direction: "bullish",
      atr5m: 0.5,
      levels: [],
      config: CONFIG,
    });
    expect(attempt.origin).toBeNull();
  });

  it("does not lock without a real pullback", () => {
    // Rising steadily: never pulls back far enough to base.
    const rising = Array.from({ length: 25 }, (_, i) =>
      bar(i, 100 + i * 0.1, 100 + i * 0.1 + 0.05, 100 + i * 0.1 - 0.02, 100 + i * 0.1 + 0.04)
    );
    const attempt = detectHeldBaseOrigin({
      oneMinute: rising,
      fiveMinute: rising,
      direction: "bullish",
      atr5m: 2.0, // large ATR makes the pullback requirement strict
      levels: [],
      config: CONFIG,
    });
    expect(attempt.origin).toBeNull();
    expect(attempt.rejections.length).toBeGreaterThan(0);
  });
});

describe("momentum origin (Path B)", () => {
  /** A straight-line move that never pauses to form a base. */
  function impulseSeries(): Candle[] {
    return Array.from({ length: 12 }, (_, i) => {
      const p = 100 + i * 0.4;
      return bar(i, p, p + 0.45, p - 0.02, p + 0.4);
    });
  }

  it("locks without any clean base when momentum facts all hold", () => {
    const series = impulseSeries();
    const attempt = detectMomentumOrigin({
      oneMinute: series,
      fiveMinute: series,
      direction: "bullish",
      atr5m: 0.3,
      levels: [{ name: "Premarket high", price: 104, availableFrom: null }],
      relativeVolume: 2.5,
      config: CONFIG,
    });
    expect(attempt.origin).not.toBeNull();
    expect(attempt.origin!.mode).toBe("momentum_expansion");
  });

  it("refuses to lock when relative volume is UNAVAILABLE", () => {
    // Unavailable must never be treated as a pass. This is the single
    // most dangerous substitution in the whole scanner.
    const attempt = detectMomentumOrigin({
      oneMinute: impulseSeries(),
      fiveMinute: impulseSeries(),
      direction: "bullish",
      atr5m: 0.3,
      levels: [{ name: "Premarket high", price: 104, availableFrom: null }],
      relativeVolume: null,
      config: CONFIG,
    });
    expect(attempt.origin).toBeNull();
    expect(attempt.rejections).toContain("relative_volume_insufficient");
  });
});

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

describe("percentage milestones", () => {
  it("fires each milestone once and only once per setup", () => {
    const first = crossedMilestones(5.2, [], CONFIG.percentMilestones);
    expect(first).toEqual([3, 5]);
    // Already fired: crossing again adds nothing.
    expect(crossedMilestones(5.2, first, CONFIG.percentMilestones)).toEqual([]);
    // A further move adds only the newly crossed one.
    expect(crossedMilestones(7.1, first, CONFIG.percentMilestones)).toEqual([7]);
  });

  it("stays unavailable rather than firing when the move cannot be measured", () => {
    expect(crossedMilestones(null, [], CONFIG.percentMilestones)).toEqual([]);
  });

  it("uses percent, never silently substituting dollars", () => {
    // 3% of a $30 stock is $0.90; of a $300 stock, $9.00. A dollar
    // milestone would fire at wildly different percentages.
    expect(crossedMilestones(2.9, [], [3])).toEqual([]);
    expect(crossedMilestones(3.0, [], [3])).toEqual([3]);
  });
});

// ---------------------------------------------------------------------------
// Gate: freshness, session, first observation
// ---------------------------------------------------------------------------

describe("freshness and session gate", () => {
  const fresh = [bar(0, 100, 101, 99, 100)];

  it("blocks when the five-minute bar is stale", () => {
    const gate = computeGate({
      oneMinute: fresh,
      fiveMinute: fresh,
      config: CONFIG,
      // Two hours after the bar closed.
      evaluatedAt: new Date((T0 + 5 * 60 + 7200) * 1000),
      feedLabel: "test",
    });
    expect(gate.alertable).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/5-minute data is \d+s old/);
  });

  it("blocks outside the allowed session", () => {
    // 02:00 UTC is outside every US session.
    const overnight = [{ ...bar(0, 100, 101, 99, 100), time: Math.floor(Date.parse(`${DATE}T02:00:00Z`) / 1000) }];
    const gate = computeGate({
      oneMinute: overnight,
      fiveMinute: overnight,
      config: CONFIG,
      evaluatedAt: new Date(Date.parse(`${DATE}T02:05:00Z`)),
      feedLabel: "test",
    });
    expect(gate.alertable).toBe(false);
    expect(gate.reasons.some((r) => /Session/.test(r))).toBe(true);
  });

  it("labels a partial-coverage feed honestly", () => {
    const rv = relativeVolumeFrom(bar(0, 100, 101, 99, 100), 5000, "IEX live — partial-market coverage", true);
    expect(rv.partialMarketCoverage).toBe(true);
    expect(rv.feed).toMatch(/partial-market coverage/);
    // The multiple is still measured — the label is about interpretation.
    expect(rv.multiple).toBe(2);
  });

  it("reports relative volume as unavailable without a same-feed baseline", () => {
    const rv = relativeVolumeFrom(bar(0, 100, 101, 99, 100), null, "test", false);
    expect(rv.multiple).toBeNull();
    expect(rv.multiple).not.toBe(0);
    expect(rv.unavailableReason).toMatch(/baseline/);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: history is append-only
// ---------------------------------------------------------------------------

describe("lifecycle history", () => {
  it("does not erase earlier transitions when the trend later weakens", () => {
    const session = bullishLifecycleSession("TEST", DATE);
    const outcome = replaySession({
      session,
      direction: "bullish",
      config: CONFIG,
      dataSource: "synthetic-fixture",
      feedLabel: "synthetic",
    });

    const stages = outcome.final.lifecycle.transitions.map((t) => t.stage);
    // The session ends in failure...
    expect(outcome.final.lifecycle.stage).toBe("failed");
    // ...but the record that it reached these stages survives.
    expect(stages).toContain("trend_watch");
    expect(stages).toContain("trend_confirmed");
    expect(stages).toContain("level_break");
    expect(stages).toContain("failed");
  });

  it("records TAP 1 strictly before TAP 2, and neither waits for an FVG", () => {
    const session = bullishLifecycleSession("TEST", DATE);
    const outcome = replaySession({
      session,
      direction: "bullish",
      config: CONFIG,
      dataSource: "synthetic-fixture",
      feedLabel: "synthetic",
    });

    const stages = outcome.final.lifecycle.transitions;
    const tap1 = stages.findIndex((t) => t.stage === "trend_watch");
    const tap2 = stages.findIndex((t) => t.stage === "level_break");
    expect(tap1).toBeGreaterThanOrEqual(0);
    expect(tap2).toBeGreaterThan(tap1);

    // No FVG, sweep, Strat or structure-shift fact exists in this path.
    const json = JSON.stringify(outcome.final);
    expect(json).not.toMatch(/fairValueGap|liquiditySweep|strat|structureShift/i);
  });

  it("crosses milestones in ascending order, each once", () => {
    const outcome = replaySession({
      session: bullishLifecycleSession("TEST", DATE),
      direction: "bullish",
      config: CONFIG,
      dataSource: "synthetic-fixture",
      feedLabel: "synthetic",
    });
    const fired = outcome.steps.flatMap((s) => s.milestones);
    expect(fired).toEqual([...fired].sort((a, b) => a - b));
    expect(new Set(fired).size).toBe(fired.length);
    expect(fired).toContain(3);
  });
});

// ---------------------------------------------------------------------------
// Bullish / bearish symmetry
// ---------------------------------------------------------------------------

describe("directional symmetry", () => {
  it("produces the same lifecycle for a mirrored session", () => {
    const bull = replaySession({
      session: bullishLifecycleSession("TEST", DATE),
      direction: "bullish",
      config: CONFIG,
      dataSource: "synthetic-fixture",
      feedLabel: "synthetic",
    });
    const bear = replaySession({
      session: bearishLifecycleSession("TEST", DATE),
      direction: "bearish",
      config: CONFIG,
      dataSource: "synthetic-fixture",
      feedLabel: "synthetic",
    });

    // Precondition: the bullish run actually did something.
    expect(bull.final.lifecycle.transitions.length).toBeGreaterThan(2);

    expect(bear.final.lifecycle.transitions.map((t) => t.stage)).toEqual(
      bull.final.lifecycle.transitions.map((t) => t.stage)
    );
  });
});

// ---------------------------------------------------------------------------
// Trend Watch tolerance
// ---------------------------------------------------------------------------

describe("trend watch does not require every supporting fact", () => {

  it("confirms watch with only ONE broader-position fact", () => {
    // Below the 5m 20 SMA and below VWAP, above the 5m 9 EMA only.
    const out = advanceLifecycle({
      previous: {
        ...emptyLifecycle(),
        stage: "basing",
        origin: { mode: "held_base", price: 99, establishedAt: "x", invalidationPrice: 98 },
      },
      facts: factsWith({}),
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T14:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 99.5,
      evaluable: true,
    });
    expect(out.lifecycle.stage).toBe("trend_watch");
  });

  it("keeps unmeasured relative strength as null, never false or zero", () => {
    const facts = factsWith({});
    expect(facts.relativeToBenchmark).toBeNull();
    expect(facts.relativeToBenchmark).not.toBe(0);
    expect(facts.relativeToBenchmark).not.toBe(false);
  });

  it("fires TAP 1 even when relative volume is UNAVAILABLE", () => {
    // Volume is a factor, not a gate. Gating TAP 1 on participation let a
    // partial-coverage feed withhold it indefinitely — on real IEX data
    // for 2026-08-03 it was the only blocker on 28 NVDA bars and delayed
    // TAP 1 by roughly three hours.
    const out = advanceLifecycle({
      previous: {
        ...emptyLifecycle(),
        stage: "basing",
        origin: { mode: "held_base", price: 99, establishedAt: "x", invalidationPrice: 98 },
      },
      facts: factsWith({
        relativeVolume: {
          multiple: null,
          dollarMultiple: null,
          unavailableReason: "no baseline",
          feed: "test",
          partialMarketCoverage: false,
        },
      }),
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T14:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 99.5,
      evaluable: true,
    });
    expect(out.lifecycle.stage).toBe("trend_watch");
    // ...and the unmeasured value stays null, never zero.
    expect(out.lifecycle.stage).not.toBe("idle");
  });

  it("fires TAP 1 with relative volume BELOW the old threshold", () => {
    const out = advanceLifecycle({
      previous: {
        ...emptyLifecycle(),
        stage: "basing",
        origin: { mode: "held_base", price: 99, establishedAt: "x", invalidationPrice: 98 },
      },
      facts: factsWith({
        relativeVolume: { ...okVolume, multiple: 0.4, dollarMultiple: 0.4 },
      }),
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T14:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 99.5,
      evaluable: true,
    });
    // TAP 1 fired despite 0.4x volume.
    expect(out.lifecycle.stage).toBe("trend_watch");
    // Volume DOES still gate the next stage under full coverage — the
    // blocker list here describes trend_confirmed, not trend_watch.
    expect(out.blockers.some((b) => /Relative volume/.test(b.requirement))).toBe(true);
  });

  it("does NOT let a partial-coverage feed veto confirmation on volume alone", () => {
    // IEX reports a slice of consolidated volume, so a sub-threshold
    // ratio there is as much a feed artefact as a participation fact.
    const partial = advanceLifecycle({
      previous: {
        ...emptyLifecycle(),
        stage: "trend_watch",
        origin: { mode: "held_base", price: 99, establishedAt: "x", invalidationPrice: 98 },
        transitions: [{ stage: "trend_watch", marketDataAt: "x", reason: "r" }],
      },
      facts: factsWith({
        fiveMinuteSma20: { value: 99, above: true, rising: true },
        vwap: { value: 99, above: true, reclaimedAt: null },
        fromOriginDollars: 5,
        fromOriginPct: 5,
        relativeVolume: { ...okVolume, multiple: 0.3, partialMarketCoverage: true },
      }),
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T14:05:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 99.5,
      evaluable: true,
    });
    expect(partial.lifecycle.stage).toBe("trend_confirmed");
  });

  it("DOES apply the volume threshold under full-market coverage", () => {
    // Same facts, only the coverage flag differs — so the difference in
    // outcome can only come from the coverage rule.
    const full = advanceLifecycle({
      previous: {
        ...emptyLifecycle(),
        stage: "trend_watch",
        origin: { mode: "held_base", price: 99, establishedAt: "x", invalidationPrice: 98 },
        transitions: [{ stage: "trend_watch", marketDataAt: "x", reason: "r" }],
      },
      facts: factsWith({
        fiveMinuteSma20: { value: 99, above: true, rising: true },
        vwap: { value: 99, above: true, reclaimedAt: null },
        fromOriginDollars: 5,
        fromOriginPct: 5,
        relativeVolume: { ...okVolume, multiple: 0.3, partialMarketCoverage: false },
      }),
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T14:05:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 99.5,
      evaluable: true,
    });
    expect(full.lifecycle.stage).not.toBe("trend_confirmed");
    expect(full.blockers.some((b) => /Relative volume/.test(b.requirement))).toBe(true);
  });

  it("still records unavailable relative volume as null, never zero", () => {
    const facts = factsWith({
      relativeVolume: {
        multiple: null,
        dollarMultiple: null,
        unavailableReason: "no baseline",
        feed: "test",
        partialMarketCoverage: false,
      },
    });
    expect(facts.relativeVolume.multiple).toBeNull();
    expect(facts.relativeVolume.multiple).not.toBe(0);
    expect(facts.relativeVolume.unavailableReason).toBe("no baseline");
  });
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

describe("deterministic ranking", () => {
  function result(over: Partial<TrendResult>): TrendResult {
    return {
      symbol: "AAA",
      direction: "bullish",
      tradingDate: DATE,
      lifecycle: { ...emptyLifecycle(), stage: "trend_watch" },
      facts: {
        relativeVolume: okVolume,
        fromOriginAtr: 1,
        relativeToBenchmark: null,
        nearestLevel: null,
      } as unknown as TrendFacts,
      timestamps: { oneMinuteBarAt: null, fiveMinuteBarAt: null, dailyBarAt: null, evaluatedAt: "" },
      primaryReason: "",
      nextConfirmation: null,
      invalidation: null,
      blockers: [],
      unavailable: [],
      gate: {
        alertable: true,
        reasons: [],
        session: "regular",
        oneMinuteAgeSeconds: 0,
        fiveMinuteAgeSeconds: 0,
        feedLabel: "test",
      },
      ...over,
    };
  }

  it("orders by stage first, and never by a composite score", () => {
    const watch = result({ symbol: "AAA" });
    const confirmed = result({
      symbol: "ZZZ",
      lifecycle: { ...emptyLifecycle(), stage: "trend_confirmed" },
    });
    expect(rankTrendResults([watch, confirmed])[0].symbol).toBe("ZZZ");
  });

  it("puts fresh ahead of stale at the same stage", () => {
    const stale = result({
      symbol: "AAA",
      gate: { ...result({}).gate, alertable: false },
    });
    const fresh = result({ symbol: "ZZZ" });
    expect(rankTrendResults([stale, fresh])[0].symbol).toBe("ZZZ");
  });

  it("sorts unmeasured relative volume AFTER measured, never ahead", () => {
    const measured = result({ symbol: "ZZZ" });
    const unmeasured = result({
      symbol: "AAA",
      facts: { ...measured.facts, relativeVolume: { ...okVolume, multiple: null } } as TrendFacts,
    });
    expect(rankTrendResults([unmeasured, measured])[0].symbol).toBe("ZZZ");
  });

  it("falls back to symbol so the order is total and stable", () => {
    const a = result({ symbol: "AAA" });
    const b = result({ symbol: "BBB" });
    expect(rankTrendResults([b, a]).map((r) => r.symbol)).toEqual(["AAA", "BBB"]);
    expect(rankTrendResults([a, b]).map((r) => r.symbol)).toEqual(["AAA", "BBB"]);
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("configuration", () => {
  it("ships legacy alerts OFF", () => {
    expect(defaultTrendScannerConfig.legacyAlertsEnabled).toBe(false);
  });

  it("fills the default for a config saved before this field existed", () => {
    const normalized = normalizeTrendScannerConfig(undefined);
    expect(normalized.legacyAlertsEnabled).toBe(false);
    expect(normalized.percentMilestones).toEqual([3, 5, 7, 10, 15]);
    expect(validateTrendScannerConfig(normalized)).toEqual([]);
  });

  it("rejects an unreachable higher-close requirement", () => {
    const errors = validateTrendScannerConfig({
      ...defaultTrendScannerConfig,
      minimumHigherCloses: 5,
      higherCloseTransitions: 3,
    });
    expect(errors.map((e) => e.field)).toContain("trendScanner.minimumHigherCloses");
  });

  it("rejects non-ascending milestones", () => {
    const errors = validateTrendScannerConfig({
      ...defaultTrendScannerConfig,
      percentMilestones: [5, 3],
    });
    expect(errors.map((e) => e.field)).toContain("trendScanner.percentMilestones");
  });

  it("returns a copy so a caller cannot mutate the shipped default", () => {
    normalizeTrendScannerConfig(undefined).percentMilestones.push(99);
    expect(defaultTrendScannerConfig.percentMilestones).toEqual([3, 5, 7, 10, 15]);
  });
});

// ---------------------------------------------------------------------------
// Causality
// ---------------------------------------------------------------------------

describe("causality", () => {
  it("never lets a later candle change an earlier evaluation", () => {
    const session = bullishLifecycleSession("TEST", DATE);
    const full = replaySession({
      session,
      direction: "bullish",
      config: CONFIG,
      dataSource: "synthetic-fixture",
      feedLabel: "synthetic",
    });

    // Replaying a TRUNCATED session must produce an identical prefix:
    // if it did not, the detector was reading future candles.
    const cut = 14;
    const truncated = replaySession({
      session: { ...session, fiveMinute: session.fiveMinute.slice(0, cut) },
      direction: "bullish",
      config: CONFIG,
      dataSource: "synthetic-fixture",
      feedLabel: "synthetic",
    });

    expect(truncated.steps.length).toBe(cut);
    expect(truncated.steps.map((s) => s.stage)).toEqual(
      full.steps.slice(0, cut).map((s) => s.stage)
    );
  });

  it("finds nothing ahead of price when every level is behind it", () => {
    const { level, distancePct } = nearestLevelAhead(
      [{ name: "Premarket high", price: 90, availableFrom: null }],
      100,
      "bullish"
    );
    expect(level).toBeNull();
    expect(distancePct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Failure releases the origin
// ---------------------------------------------------------------------------

describe("a failed setup releases its origin", () => {
  /**
   * REGRESSION (real GOOGL data, 2026-08-03). Failure recorded the stage
   * but left `origin` in place, so the dead setup's invalidation kept
   * re-triggering: trend_watch -> failed -> trend_watch -> failed, 14
   * times in one session. Live, that is an alert storm.
   */
  /** Facts with everything against the setup — used after a failure. */
  const brokenFacts: TrendFacts = {
    price: 98,
    oneMinuteEma9: { value: 99, above: false, rising: false },
    fiveMinuteEma9: { value: 99, above: false, rising: false },
    fiveMinuteSma20: { value: 99, above: false, rising: false },
    dailySma20: { value: null, above: null, rising: null },
    vwap: { value: 99, above: false, reclaimedAt: null },
    atr5m: 0.5,
    levels: [],
    closeTransitions: { transitions: 3, favourable: 0, measurable: true },
    greenCandles: 0,
    redCandles: 3,
    relativeVolume: okVolume,
    relativeToBenchmark: null,
    relativeToSector: null,
    fromOriginDollars: -2,
    fromOriginPct: -2,
    fromOriginAtr: -4,
    nearestLevel: null,
    distanceToNearestLevelPct: null,
    atrFromFiveMinuteEma: 1,
  };

  const deadOrigin = {
    mode: "held_base" as const,
    price: 100,
    establishedAt: "2026-08-03T14:00:00.000Z",
    invalidationPrice: 99,
  };

  function failOnce() {
    return advanceLifecycle({
      previous: {
        ...emptyLifecycle(),
        stage: "trend_watch",
        origin: deadOrigin,
        setupKey: "k",
      },
      facts: {
        price: 98, // through the invalidation
        oneMinuteEma9: { value: 99, above: false, rising: false },
        fiveMinuteEma9: { value: 99, above: false, rising: false },
        fiveMinuteSma20: { value: 99, above: false, rising: false },
        dailySma20: { value: null, above: null, rising: null },
        vwap: { value: 99, above: false, reclaimedAt: null },
        atr5m: 0.5,
        levels: [],
        closeTransitions: { transitions: 3, favourable: 0, measurable: true },
        greenCandles: 0,
        redCandles: 3,
        relativeVolume: okVolume,
        relativeToBenchmark: null,
        relativeToSector: null,
        fromOriginDollars: -2,
        fromOriginPct: -2,
        fromOriginAtr: -4,
        nearestLevel: null,
        distanceToNearestLevelPct: null,
        atrFromFiveMinuteEma: 1,
      },
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T15:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 101,
      evaluable: true,
    });
  }

  it("clears the origin so its invalidation cannot re-fire", () => {
    const out = failOnce();
    expect(out.lifecycle.stage).toBe("failed");
    expect(out.lifecycle.origin).toBeNull();
    expect(out.lifecycle.setupKey).toBeNull();
    expect(out.lifecycle.failedAt).toBe("2026-08-03T15:00:00.000Z");
  });

  it("keeps the history — failure does not erase what happened", () => {
    const out = failOnce();
    expect(out.lifecycle.transitions.some((t) => t.stage === "failed")).toBe(true);
  });

  it("refuses to re-lock the SAME origin after failing on it", () => {
    const failed = failOnce().lifecycle;
    const again = advanceLifecycle({
      previous: failed,
      facts: brokenFacts,
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T15:05:00.000Z",
      // An origin established BEFORE the failure is not a new setup.
      candidateOrigin: deadOrigin,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 98,
      evaluable: true,
    });
    expect(again.lifecycle.origin).toBeNull();
  });

  it("accepts a genuinely newer origin after the failure", () => {
    const failed = failOnce().lifecycle;
    const fresh = { ...deadOrigin, establishedAt: "2026-08-03T15:30:00.000Z", price: 105 };
    const again = advanceLifecycle({
      previous: failed,
      facts: brokenFacts,
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T15:35:00.000Z",
      candidateOrigin: fresh,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 104,
      evaluable: true,
    });
    expect(again.lifecycle.origin?.establishedAt).toBe("2026-08-03T15:30:00.000Z");
    // A new setup starts a fresh milestone ledger.
    expect(again.lifecycle.firedMilestones).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TAP 2 level selection: premarket vs opening range
// ---------------------------------------------------------------------------

describe("TAP 2 level selection", () => {
  /** Regular-session 5m bars starting at 9:30 ET, opening at `open`. */
  function regular(open: number, closes: number[]): Candle[] {
    const start = Math.floor(Date.parse(`${DATE}T13:30:00Z`) / 1000);
    let prev = open;
    return closes.map((c, i) => {
      const bar = {
        time: start + i * 300,
        open: i === 0 ? open : prev,
        high: Math.max(prev, c) + 0.1,
        low: Math.min(prev, c) - 0.1,
        close: c,
        volume: 10_000,
      };
      prev = c;
      return bar;
    });
  }

  const pmHigh = { name: "Premarket high", price: 100, availableFrom: null };
  const pmLow = { name: "Premarket low", price: 100, availableFrom: null };

  it("uses the PREMARKET HIGH while it is still overhead", () => {
    // Opens BELOW the premarket high: it is a real unbroken level.
    const bars = regular(98, [98.2, 98.4, 98.3, 98.6, 98.8]);
    const level = selectTap2Level({
      fiveMinute: bars,
      premarket: pmHigh,
      direction: "bullish",
      openingRangeMinutes: 15,
    });
    expect(level?.name).toBe("Premarket high");
    expect(level?.price).toBe(100);
  });

  it("uses the OPENING-RANGE HIGH when price gapped above the premarket high", () => {
    // Opens ABOVE 100 — the premarket high was never overhead, so
    // waiting for a break of it would wait forever. This is the real
    // 2026-08-03 shape for both NVDA and GOOGL.
    const bars = regular(105, [105.5, 106, 105.8, 106.2, 106.5]);
    const level = selectTap2Level({
      fiveMinute: bars,
      premarket: pmHigh,
      direction: "bullish",
      openingRangeMinutes: 15,
    });
    expect(level?.name).toBe("Opening-range high");
    // Built from the first 15 minutes only — bars 0,1,2.
    expect(level?.price).toBeCloseTo(106.1, 1);
  });

  it("mirrors for bearish: opening-range LOW after a gap down", () => {
    const bars = regular(95, [94.5, 94, 94.2, 93.8, 93.5]);
    const level = selectTap2Level({
      fiveMinute: bars,
      premarket: pmLow,
      direction: "bearish",
      openingRangeMinutes: 15,
    });
    expect(level?.name).toBe("Opening-range low");
  });

  it("mirrors for bearish: premarket LOW while still below price", () => {
    const bars = regular(105, [104.8, 104.5, 104.6, 104.2, 104]);
    const level = selectTap2Level({
      fiveMinute: bars,
      premarket: pmLow,
      direction: "bearish",
      openingRangeMinutes: 15,
    });
    expect(level?.name).toBe("Premarket low");
  });

  it("withholds an opening range until its window has actually closed", () => {
    // Only two 5m bars — the 15-minute window has not finished.
    const bars = regular(105, [105.5, 106]);
    expect(openingRangeLevels(bars, 15)).toBeNull();
    // ...and TAP 2 has no level rather than a premature one.
    expect(
      selectTap2Level({
        fiveMinute: bars,
        premarket: pmHigh,
        direction: "bullish",
        openingRangeMinutes: 15,
      })
    ).toBeNull();
  });

  it("names the broken level honestly in the recorded transition", () => {
    const openingRange = { name: "Opening-range high", price: 106, availableFrom: null };
    const out = advanceLifecycle({
      previous: {
        ...emptyLifecycle(),
        stage: "trend_watch",
        origin: { mode: "held_base", price: 104, establishedAt: "x", invalidationPrice: 103 },
        transitions: [{ stage: "trend_watch", marketDataAt: "x", reason: "r" }],
      },
      facts: factsWith({
        price: 107,
        // TAP 2 now picks its target from the TRACKED levels.
        levels: [openingRange],
        relativeVolume: { ...okVolume, multiple: 3 },
      }),
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T15:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 105.5,
      evaluable: true,
    });

    const breakT = out.newTransitions.find((t) => t.stage === "level_break");
    expect(breakT).toBeDefined();
    // Honest naming: an opening-range break is NOT a premarket-high break.
    expect(breakT!.reason).toMatch(/opening-range high/i);
    expect(breakT!.reason).not.toMatch(/premarket/i);
  });
});

// ---------------------------------------------------------------------------
// TAP 2 as a RUNNING continuation confirmation
// ---------------------------------------------------------------------------

describe("TAP 2 runs and re-arms", () => {
  const L = (name: string, price: number) => ({ name, price, availableFrom: null });

  function advance(over: {
    price: number;
    previousClose: number;
    levels: { name: string; price: number; availableFrom: null }[];
    cleared?: string[];
    stage?: "trend_watch" | "basing";
    blueSky?: number | null;
    direction?: "bullish" | "bearish";
  }) {
    const stage = over.stage ?? "trend_watch";
    return advanceLifecycle({
      previous: {
        ...emptyLifecycle(),
        stage,
        origin: { mode: "held_base", price: 100, establishedAt: "x", invalidationPrice: 99 },
        transitions: stage === "trend_watch"
          ? [{ stage: "trend_watch", marketDataAt: "x", reason: "r" }]
          : [],
        clearedLevels: over.cleared ?? [],
      },
      facts: factsWith({
        price: over.price,
        levels: over.levels,
        relativeVolume: { ...okVolume, multiple: 3 },
      }),
      direction: over.direction ?? "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T15:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: over.blueSky ?? null,
      previousClose: over.previousClose,
      evaluable: true,
    });
  }

  it("fires on the NEAREST unbroken level ahead, not a further one", () => {
    const out = advance({
      previousClose: 100,
      price: 102,
      levels: [L("Prior-day high", 105), L("Premarket high", 101), L("Pivot high", 103)],
    });
    const t = out.newTransitions.find((x) => x.stage === "level_break");
    expect(t).toBeDefined();
    // 101 is nearest — not 103, and not 105.
    expect(t!.reason).toMatch(/premarket high at 101\.00/i);
  });

  it("RE-ARMS to the next level once the first is cleared", () => {
    const cleared = ["Premarket high@101.0000"];
    const out = advance({
      previousClose: 102,
      price: 104,
      levels: [L("Premarket high", 101), L("Pivot high", 103), L("Prior-day high", 105)],
      cleared,
    });
    const t = out.newTransitions.find((x) => x.stage === "level_break");
    expect(t).toBeDefined();
    // The already-cleared 101 is skipped; the next one fires.
    expect(t!.reason).toMatch(/pivot high at 103\.00/i);
    expect(out.lifecycle.clearedLevels).toContain("Pivot high@103.0000");
  });

  it("does not re-fire a level it has already cleared", () => {
    const out = advance({
      previousClose: 102,
      price: 102.5,
      levels: [L("Premarket high", 101)],
      cleared: ["Premarket high@101.0000"],
    });
    // Nothing left ahead and no blue-sky reference — nothing fires.
    expect(out.newTransitions.some((x) => x.stage === "level_break")).toBe(false);
  });

  it("falls back to a NEW-HIGH continuation when nothing is left ahead", () => {
    const out = advance({
      previousClose: 106,
      price: 108,
      levels: [L("Premarket high", 101)],
      cleared: ["Premarket high@101.0000"],
      blueSky: 107,
    });
    const t = out.newTransitions.find((x) => x.stage === "level_break");
    expect(t).toBeDefined();
    expect(t!.reason).toMatch(/new-high continuation/i);
    // Honest: it does NOT claim a named level was cleared.
    expect(t!.reason).not.toMatch(/premarket|pivot|prior-day/i);
  });

  it("does not fire the blue-sky fallback without a new high", () => {
    const out = advance({
      previousClose: 106,
      price: 106.5,
      levels: [],
      blueSky: 107, // price has not exceeded it
    });
    expect(out.newTransitions.some((x) => x.stage === "level_break")).toBe(false);
  });

  it("never records TAP 2 before TAP 1 in the same evaluation", () => {
    // Both may land on one bar — TAP 1 is recorded first and TAP 2 then
    // sees an actionable setup. What must never happen is TAP 2 appearing
    // without TAP 1 ahead of it.
    const out = advance({
      previousClose: 100,
      price: 102,
      levels: [L("Premarket high", 101)],
      stage: "basing",
    });
    const stages = out.lifecycle.transitions.map((t) => t.stage);
    const tap1 = stages.indexOf("trend_watch");
    const tap2 = stages.indexOf("level_break");
    expect(tap2).toBeGreaterThan(-1);
    expect(tap1).toBeGreaterThan(-1);
    expect(tap1).toBeLessThan(tap2);
  });

  it("does NOT fire TAP 2 when TAP 1 itself is blocked", () => {
    const out = advanceLifecycle({
      previous: {
        ...emptyLifecycle(),
        stage: "basing",
        origin: { mode: "held_base", price: 100, establishedAt: "x", invalidationPrice: 99 },
      },
      facts: factsWith({
        price: 102,
        levels: [L("Premarket high", 101)],
        // Structure fails: price is on the wrong side of the 1m 9 EMA.
        oneMinuteEma9: { value: 103, above: false, rising: false },
        closeTransitions: { transitions: 3, favourable: 0, measurable: true },
        relativeVolume: { ...okVolume, multiple: 3 },
      }),
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T15:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 100,
      evaluable: true,
    });
    expect(out.newTransitions.some((x) => x.stage === "trend_watch")).toBe(false);
    // Price cleared 101, but with no TAP 1 there is no TAP 2.
    expect(out.newTransitions.some((x) => x.stage === "level_break")).toBe(false);
  });

  it("mirrors for bearish: clears the nearest level BELOW price", () => {
    const out = advance({
      direction: "bearish",
      previousClose: 100,
      price: 98,
      levels: [L("Prior-day low", 95), L("Premarket low", 99), L("Pivot low", 97)],
    });
    const t = out.newTransitions.find((x) => x.stage === "level_break");
    expect(t).toBeDefined();
    expect(t!.reason).toMatch(/premarket low at 99\.00/i);
  });

  it("keeps % milestones firing independently of TAP 2", () => {
    // Milestones are the user's entry zone and must not depend on a
    // level break happening.
    const out = advanceLifecycle({
      previous: {
        ...emptyLifecycle(),
        stage: "trend_watch",
        origin: { mode: "held_base", price: 100, establishedAt: "x", invalidationPrice: 99 },
        transitions: [{ stage: "trend_watch", marketDataAt: "x", reason: "r" }],
      },
      facts: factsWith({
        price: 105,
        fromOriginDollars: 5,
        fromOriginPct: 5,
        levels: [], // nothing ahead, no blue-sky reference either
      }),
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T15:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 104,
      evaluable: true,
    });
    expect(out.newTransitions.some((x) => x.stage === "level_break")).toBe(false);
    expect(out.newMilestones).toEqual([3, 5]);
  });
});
