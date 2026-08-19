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
  computeTrendFacts,
  movingAverageFact,
  nearestLevelAhead,
  openingRangeLevels,
  selectTap2Level,
} from "@/lib/trend/facts";
import { calculateAtr } from "@/lib/indicators/atr";
import { latestValid } from "@/lib/indicators/movingAverages";
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
import type { RelativeVolumeFact, TrendFacts, TrendLifecycle, TrendResult } from "@/lib/trend/types";

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
    adversePivots: [],
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
    adversePivots: [],
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
        adversePivots: [],
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

// ---------------------------------------------------------------------------
// A PREMARKET-FORMED BASE IS THE ORIGIN
//
// On a gap-and-go the base forms before the bell. Fed regular bars alone the
// base-finder anchors at the post-run shelf instead (real GOOGL 2026-08-04:
// 376.14 at 10:55 against a base of 366.56). Each test below asserts the
// premarket feed is what changes the answer, so none can pass vacuously.
// ---------------------------------------------------------------------------

/** A premarket 1m bar, `back` minutes before the opening bell. */
function preBar(back: number, o: number, h: number, l: number, c: number): Candle {
  return { time: T0 - back * 60, open: o, high: h, low: l, close: c, volume: 10_000 };
}

function agg5(oneMinute: Candle[]): Candle[] {
  const buckets = new Map<number, Candle[]>();
  for (const c of oneMinute) {
    const k = Math.floor(c.time / 300) * 300;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(c);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([time, bs]) => ({
    time,
    open: bs[0].open,
    high: Math.max(...bs.map((b) => b.high)),
    low: Math.min(...bs.map((b) => b.low)),
    close: bs[bs.length - 1].close,
    volume: bs.reduce((a, b) => a + b.volume, 0),
  }));
}

/**
 * 90 premarket minutes ending at the bell. The last 30 — the base-finder
 * lookback — hold the shape: a 100.00 low, a rally to ~104, a 101.00 higher
 * low, then a hold and a drift into the open.
 */
function premarketWithHeldBase(): Candle[] {
  const bars: Candle[] = [];
  for (let i = 0; i < 60; i++) {
    const drift = 103 + (i % 5) * 0.2;
    bars.push(preBar(90 - i, drift, drift + 0.5, drift - 0.5, drift + 0.1));
  }
  bars.push(preBar(30, 100.4, 100.5, 100.0, 100.2)); // session extreme
  for (let i = 0; i < 6; i++) {
    const up = 100.8 + i * 0.55;
    bars.push(preBar(29 - i, up, up + 0.35, up - 0.2, up + 0.3)); // rally to ~104
  }
  bars.push(preBar(23, 103.4, 103.5, 101.0, 101.2)); // the higher low: candidate
  for (let i = 0; i < 5; i++) {
    const hold = 101.3 + i * 0.25;
    bars.push(preBar(22 - i, hold, hold + 0.3, hold - 0.2, hold + 0.2)); // holds
  }
  for (let i = 0; i < 17; i++) {
    const up = 102.6 + i * 0.05;
    bars.push(preBar(17 - i, up, up + 0.25, up - 0.1, up + 0.15));
  }
  return bars;
}

/** Five regular 1m bars running up from the base, never breaching it. */
function regularRunUp(lowOverride?: number): Candle[] {
  return [0, 1, 2, 3, 4].map((i) => {
    const base = 103.6 + i * 0.5;
    const low = i === 2 && lowOverride !== undefined ? lowOverride : base - 0.3;
    return bar(i, base, base + 0.6, low, base + 0.45);
  });
}

function evaluateAtOpen(args: { premarket: Candle[] | undefined; regularOne: Candle[] }) {
  const regularFive = agg5(args.regularOne);
  return evaluateTrend({
    symbol: "TEST",
    direction: "bullish",
    tradingDate: DATE,
    oneMinute: args.regularOne,
    fiveMinute: regularFive,
    daily: [],
    levels: [{ name: "Premarket high", price: 104.0, availableFrom: null }],
    premarketLevel: { name: "Premarket high", price: 104.0, availableFrom: null },
    premarketOneMinute: args.premarket,
    premarketFiveMinute: args.premarket === undefined ? undefined : agg5(args.premarket),
    relativeVolume: okVolume,
    relativeToBenchmark: null,
    relativeToSector: null,
    previous: emptyLifecycle(),
    config: CONFIG,
    evaluatedAt: new Date((regularFive[regularFive.length - 1].time + 300) * 1000),
    pivotLength: 3,
    feedLabel: "test",
  });
}

describe("a premarket-formed base anchors the origin", () => {
  it("locks the premarket base at the open, which regular bars alone cannot find", () => {
    const regularOne = regularRunUp();

    // PRECONDITION: without premarket bars there is no origin at all, so a
    // pass below cannot come from the regular session finding it anyway.
    const without = evaluateAtOpen({ premarket: undefined, regularOne });
    expect(without.result.lifecycle.origin).toBeNull();

    const withPre = evaluateAtOpen({ premarket: premarketWithHeldBase(), regularOne });
    const origin = withPre.result.lifecycle.origin;
    expect(origin).not.toBeNull();
    expect(origin?.mode).toBe("held_base");
    // The base region, not an exact bar: which candidate in the base wins
    // depends on stabilisation, and pinning one would test the fixture
    // rather than the behaviour. What matters is that it anchors DOWN in
    // the base and not up at the post-run shelf.
    expect(origin!.price).toBeGreaterThan(100.5);
    expect(origin!.price).toBeLessThan(102);
    // Below the opening price — the whole point of anchoring premarket.
    expect(origin!.price).toBeLessThan(regularOne[0].open);
    // It locked BEFORE the bell — that is what makes it a premarket base.
    expect(Date.parse(origin!.establishedAt) / 1000).toBeLessThan(T0);
  });

  it("refuses a premarket base that price has already traded through", () => {
    const premarket = premarketWithHeldBase();
    // PRECONDITION: with the base intact this same fixture DOES lock, so
    // the null below is caused by the breach and nothing else.
    const intact = evaluateAtOpen({ premarket, regularOne: regularRunUp() });
    expect(intact.result.lifecycle.origin).not.toBeNull();

    // Now a regular bar trades below the base: it is history, not an origin.
    const breached = evaluateAtOpen({ premarket, regularOne: regularRunUp(100.0) });
    expect(breached.result.lifecycle.origin).toBeNull();
  });

  it("records the swing high the base retraced from", () => {
    const attempt = detectHeldBaseOrigin({
      oneMinute: premarketWithHeldBase(),
      fiveMinute: agg5(premarketWithHeldBase()),
      direction: "bullish",
      atr5m: 0.6,
      levels: [],
      config: CONFIG,
    });
    expect(attempt.origin?.price).toBeCloseTo(101.0, 6);
    // The rally high before the candidate, not a later one.
    expect(attempt.origin?.pullbackFrom).toBeGreaterThan(103.0);
  });
});

describe("the three entry levels are tracked", () => {
  it("tracks the session open and the pullback swing high alongside the premarket high", () => {
    const regularOne = regularRunUp();
    const facts = computeTrendFacts({
      direction: "bullish",
      oneMinute: regularOne,
      fiveMinute: agg5(regularOne),
      daily: [],
      levels: [{ name: "Premarket high", price: 104.0, availableFrom: null }],
      relativeVolume: okVolume,
      relativeToBenchmark: null,
      relativeToSector: null,
      origin: {
        mode: "held_base",
        price: 101.0,
        establishedAt: new Date((T0 - 60) * 1000).toISOString(),
        invalidationPrice: 100.8,
        pullbackFrom: 103.5,
      },
      transitions: CONFIG.higherCloseTransitions,
      pivotLength: 3,
    });

    const names = facts.levels.map((l) => l.name);
    expect(names).toContain("Premarket high");
    expect(names).toContain("Session open");
    expect(names).toContain("Pullback swing high");

    expect(facts.levels.find((l) => l.name === "Session open")?.price).toBeCloseTo(103.6, 6);
    expect(facts.levels.find((l) => l.name === "Pullback swing high")?.price).toBeCloseTo(103.5, 6);
  });

  it("omits the pullback swing high when the origin never recorded one", () => {
    const regularOne = regularRunUp();
    const facts = computeTrendFacts({
      direction: "bullish",
      oneMinute: regularOne,
      fiveMinute: agg5(regularOne),
      daily: [],
      levels: [],
      relativeVolume: okVolume,
      relativeToBenchmark: null,
      relativeToSector: null,
      // Path B locks no pullback high — it stays absent, never guessed.
      origin: {
        mode: "momentum_expansion",
        price: 101.0,
        establishedAt: new Date(T0 * 1000).toISOString(),
        invalidationPrice: 100.8,
      },
      transitions: CONFIG.higherCloseTransitions,
      pivotLength: 3,
    });
    expect(facts.levels.map((l) => l.name)).not.toContain("Pullback swing high");
    // PRECONDITION: the session-open level still IS derived, so the negative
    // above is about the pullback level specifically, not an empty list.
    expect(facts.levels.map((l) => l.name)).toContain("Session open");
  });
});

// ---------------------------------------------------------------------------
// HOLD THROUGH PULLBACKS, CONTINUE ON RECLAIM, FAIL ONLY ON STRUCTURE BREAK
//
// The old failure rule ("lost both the 1m 9 EMA and the 5m 20 SMA") never
// referenced the origin, so a trend that had run 2.50% and paused for one
// bar was killed exactly like a setup that never worked — real GOOGL
// 2026-08-04 at 11:30. Failure is now a structure break only.
// ---------------------------------------------------------------------------

const LIVE_ORIGIN = {
  mode: "held_base" as const,
  price: 100,
  establishedAt: "2026-08-03T13:35:00.000Z",
  invalidationPrice: 99.0,
};

/** A live, already-entered setup with its stop trailed to `stop`. */
function liveLifecycle(overrides: Partial<TrendLifecycle> = {}): TrendLifecycle {
  return {
    ...emptyLifecycle(),
    stage: "level_break",
    origin: LIVE_ORIGIN,
    setupKey: "k",
    structureStop: 100,
    transitions: [
      { stage: "trend_watch", marketDataAt: "2026-08-03T13:40:00.000Z", reason: "entered" },
    ],
    ...overrides,
  };
}

/** Price pulled back to the averages: both MAs against, structure intact. */
function pullbackFacts(price: number, overrides: Partial<TrendFacts> = {}): TrendFacts {
  return factsWith({
    price,
    // BOTH of these are what used to kill the setup outright.
    oneMinuteEma9: { value: price + 0.5, above: false, rising: false },
    fiveMinuteSma20: { value: price + 0.5, above: false, rising: false },
    fiveMinuteEma9: { value: price + 0.5, above: false, rising: false },
    vwap: { value: price + 0.5, above: false, reclaimedAt: null },
    atr5m: 0.5,
    fromOriginDollars: price - 100,
    fromOriginPct: price - 100,
    ...overrides,
  });
}

function advance(lifecycle: TrendLifecycle, facts: TrendFacts, marketDataAt: string) {
  return advanceLifecycle({
    previous: lifecycle,
    facts,
    direction: "bullish",
    config: CONFIG,
    marketDataAt,
    candidateOrigin: null,
    hasBasingCandidate: false,
    blueSkyReference: null,
    previousClose: facts.price === null ? null : facts.price - 0.1,
    evaluable: true,
  });
}

describe("a pullback to the averages is held, not failed", () => {
  it("does not fail while price is above the trailing structure stop", () => {
    // PRECONDITION: both moving-average facts are against the setup —
    // exactly the condition that used to fail it.
    const facts = pullbackFacts(101, {
      // A swing high overhead, so there is something to have pulled back
      // FROM. Without one there is no pullback to be holding through.
      levels: [{ name: "Pivot high", price: 103, availableFrom: "2026-08-03T14:30:00.000Z" }],
    });
    expect(facts.oneMinuteEma9.above).toBe(false);
    expect(facts.fiveMinuteSma20.above).toBe(false);

    const out = advance(liveLifecycle(), facts, "2026-08-03T15:30:00.000Z");
    expect(out.newTransitions.map((t) => t.stage)).not.toContain("failed");
    expect(out.lifecycle.origin).not.toBeNull();
    // And it is marked as holding rather than quietly carrying on.
    expect(out.lifecycle.holding).toBe(true);
  });

  it("fails when a completed close breaks the trailing structure stop", () => {
    // Same setup, same averages — only the close relative to the stop
    // differs, so this isolates the structure rule.
    const out = advance(liveLifecycle(), pullbackFacts(99.5), "2026-08-03T15:30:00.000Z");
    const failed = out.newTransitions.find((t) => t.stage === "failed");
    expect(failed).toBeDefined();
    expect(failed?.reason).toContain("Structure break");
    expect(out.lifecycle.origin).toBeNull();
  });

  it("trails the stop up to a confirmed higher low", () => {
    const facts = pullbackFacts(103, {
      adversePivots: [
        { name: "Pivot low", price: 102, availableFrom: "2026-08-03T15:00:00.000Z" },
      ],
    });
    const out = advance(liveLifecycle(), facts, "2026-08-03T15:30:00.000Z");
    expect(out.lifecycle.structureStop).toBeCloseTo(102, 6);
    // PRECONDITION: it started at the origin, so this is a real trail.
    expect(liveLifecycle().structureStop).toBeCloseTo(100, 6);
  });
});

describe("continuation on the reclaim", () => {
  /** A confirmed higher low at 102 and the swing high it pulled back from. */
  function continuationFacts(price: number): TrendFacts {
    return pullbackFacts(price, {
      adversePivots: [
        { name: "Pivot low", price: 102, availableFrom: "2026-08-03T15:00:00.000Z" },
      ],
      levels: [
        { name: "Pivot high", price: 103, availableFrom: "2026-08-03T14:30:00.000Z" },
      ],
    });
  }

  it("fires a continuation on a higher low plus a close back through the swing high", () => {
    const out = advance(liveLifecycle(), continuationFacts(103.5), "2026-08-03T15:30:00.000Z");
    const fire = out.newTransitions.find((t) => t.reason.startsWith("Continuation"));
    expect(fire).toBeDefined();
    expect(fire?.stage).toBe("level_break");
    expect(out.lifecycle.continuationCount).toBe(1);
    // The stop trails up to the higher low that armed it.
    expect(out.lifecycle.structureStop).toBeCloseTo(102, 6);
  });

  it("does not fire on the higher low alone, without the take-out", () => {
    // PRECONDITION: the SAME higher low fires once price clears the high.
    const fires = advance(liveLifecycle(), continuationFacts(103.5), "2026-08-03T15:30:00.000Z");
    expect(fires.newTransitions.some((t) => t.reason.startsWith("Continuation"))).toBe(true);

    // Below the swing high: a base alone must never re-arm. This is the
    // guard that stops the old trend_watch -> failed storm returning.
    const out = advance(liveLifecycle(), continuationFacts(102.5), "2026-08-03T15:30:00.000Z");
    expect(out.newTransitions.some((t) => t.reason.startsWith("Continuation"))).toBe(false);
  });

  it("does not re-fire without a FRESH higher low", () => {
    const first = advance(liveLifecycle(), continuationFacts(103.5), "2026-08-03T15:30:00.000Z");
    // PRECONDITION: the first one fired.
    expect(first.newTransitions.some((t) => t.reason.startsWith("Continuation"))).toBe(true);

    // A DIFFERENT swing high is taken out — so `clearedLevels` cannot be
    // what blocks this — but the higher low is the SAME 102 that already
    // armed the last continuation. Only the fresh-higher-low rule can
    // stop it, which is exactly the rule under test.
    const sameLowNewHigh = pullbackFacts(104.5, {
      adversePivots: [
        { name: "Pivot low", price: 102, availableFrom: "2026-08-03T15:00:00.000Z" },
      ],
      levels: [
        { name: "Pivot high", price: 104, availableFrom: "2026-08-03T14:45:00.000Z" },
      ],
    });
    const second = advance(first.lifecycle, sameLowNewHigh, "2026-08-03T15:35:00.000Z");
    expect(second.newTransitions.some((t) => t.reason.startsWith("Continuation"))).toBe(false);
    expect(second.lifecycle.continuationCount).toBe(1);
  });

  it("stops at the per-session continuation cap", () => {
    const capped = liveLifecycle({ continuationCount: CONFIG.maxContinuationsPerSession });
    const out = advance(capped, continuationFacts(103.5), "2026-08-03T15:30:00.000Z");
    expect(out.newTransitions.some((t) => t.reason.startsWith("Continuation"))).toBe(false);
    // PRECONDITION: one under the cap, the identical facts DO fire.
    const under = liveLifecycle({ continuationCount: CONFIG.maxContinuationsPerSession - 1 });
    const ok = advance(under, continuationFacts(103.5), "2026-08-03T15:30:00.000Z");
    expect(ok.newTransitions.some((t) => t.reason.startsWith("Continuation"))).toBe(true);
  });
});

describe("basing is not a one-way trap", () => {
  it("allows a new origin to lock from basing", () => {
    const newOrigin = {
      mode: "held_base" as const,
      price: 105,
      establishedAt: "2026-08-03T15:40:00.000Z",
      invalidationPrice: 104,
    };
    const out = advanceLifecycle({
      previous: { ...emptyLifecycle(), stage: "basing", failedAt: "2026-08-03T15:00:00.000Z" },
      facts: pullbackFacts(106),
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T15:45:00.000Z",
      candidateOrigin: newOrigin,
      hasBasingCandidate: true,
      blueSkyReference: null,
      previousClose: 105.9,
      evaluable: true,
    });
    expect(out.lifecycle.origin?.price).toBeCloseTo(105, 6);
    // The stop starts at the new base.
    expect(out.lifecycle.structureStop).toBeCloseTo(105, 6);
  });
});

// ---------------------------------------------------------------------------
// ALERT-WORTHINESS: quiet the ladder without changing the ride
// ---------------------------------------------------------------------------

describe("blue-sky continuation is pullback-gated", () => {
  /** No tracked level ahead, price making a new high: a blue-sky setup. */
  function blueSkyFacts(price: number, adversePivots: TrendFacts["adversePivots"]): TrendFacts {
    return factsWith({
      price,
      levels: [],
      adversePivots,
      atr5m: 0.5,
      fromOriginDollars: price - 100,
      fromOriginPct: price - 100,
    });
  }

  function advanceBlueSky(lifecycle: TrendLifecycle, facts: TrendFacts) {
    return advanceLifecycle({
      previous: lifecycle,
      facts,
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T17:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      // Everything since the origin topped out here.
      blueSkyReference: facts.price === null ? null : facts.price - 0.2,
      previousClose: facts.price === null ? null : facts.price - 0.1,
      evaluable: true,
    });
  }

  it("fires the FIRST new-high continuation of a leg with no pullback needed", () => {
    const out = advanceBlueSky(liveLifecycle(), blueSkyFacts(105, []));
    expect(out.newTransitions.some((t) => t.reason.startsWith("New-high"))).toBe(true);
    // And it stamps the gate for next time.
    expect(out.lifecycle.lastContinuationAt).toBe("2026-08-03T17:00:00.000Z");
  });

  it("does NOT fire again on a bare incremental high with no pullback", () => {
    const armed = liveLifecycle({ lastContinuationAt: "2026-08-03T16:00:00.000Z" });
    // No confirmed higher low since that alert — just a higher close.
    const out = advanceBlueSky(armed, blueSkyFacts(106, []));
    expect(out.newTransitions.some((t) => t.reason.startsWith("New-high"))).toBe(false);
  });

  it("fires again once a genuine higher low has confirmed since the last one", () => {
    const armed = liveLifecycle({ lastContinuationAt: "2026-08-03T16:00:00.000Z" });
    // PRECONDITION: identical bar without the pullback stays silent.
    expect(
      advanceBlueSky(armed, blueSkyFacts(106, [])).newTransitions.some((t) =>
        t.reason.startsWith("New-high")
      )
    ).toBe(false);

    const withPullback = blueSkyFacts(106, [
      { name: "Pivot low", price: 103, availableFrom: "2026-08-03T16:30:00.000Z" },
    ]);
    const out = advanceBlueSky(armed, withPullback);
    expect(out.newTransitions.some((t) => t.reason.startsWith("New-high"))).toBe(true);
  });

  it("still alerts a NAMED key level once, pullback or not", () => {
    const armed = liveLifecycle({ lastContinuationAt: "2026-08-03T16:00:00.000Z" });
    const facts = factsWith({
      price: 106,
      levels: [{ name: "Premarket high", price: 105, availableFrom: null }],
      adversePivots: [],
      atr5m: 0.5,
      fromOriginDollars: 6,
      fromOriginPct: 6,
    });
    const out = advanceLifecycle({
      previous: armed,
      facts,
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T17:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: 105.8,
      previousClose: 104.5,
      evaluable: true,
    });
    expect(
      out.newTransitions.some((t) => t.reason.includes("premarket high"))
    ).toBe(true);
  });
});

describe("chop guard on new legs", () => {
  const freshOrigin = (at: string) => ({
    mode: "held_base" as const,
    price: 105,
    establishedAt: at,
    invalidationPrice: 104,
  });

  function tryLock(previous: TrendLifecycle, marketDataAt: string, originAt: string) {
    return advanceLifecycle({
      previous,
      facts: factsWith({ price: 106, atr5m: 0.5, adversePivots: [] }),
      direction: "bullish",
      config: CONFIG,
      marketDataAt,
      candidateOrigin: freshOrigin(originAt),
      hasBasingCandidate: true,
      blueSkyReference: null,
      previousClose: 105.5,
      evaluable: true,
    });
  }

  it("refuses a new leg until the cooldown has elapsed", () => {
    const failed: TrendLifecycle = {
      ...emptyLifecycle(),
      stage: "failed",
      failedAt: "2026-08-03T17:00:00.000Z",
    };
    // Five minutes later: too soon.
    const tooSoon = tryLock(failed, "2026-08-03T17:05:00.000Z", "2026-08-03T17:02:00.000Z");
    expect(tooSoon.lifecycle.origin).toBeNull();

    // PRECONDITION: the SAME candidate locks once the cooldown passes.
    const later = tryLock(failed, "2026-08-03T17:20:00.000Z", "2026-08-03T17:02:00.000Z");
    expect(later.lifecycle.origin).not.toBeNull();
  });

  it("refuses a new leg once the per-session cap is spent", () => {
    const spent: TrendLifecycle = {
      ...emptyLifecycle(),
      stage: "failed",
      failedAt: "2026-08-03T17:00:00.000Z",
      legCount: CONFIG.maxLegsPerSession,
    };
    const out = tryLock(spent, "2026-08-03T17:20:00.000Z", "2026-08-03T17:02:00.000Z");
    expect(out.lifecycle.origin).toBeNull();

    // PRECONDITION: one under the cap, the identical call locks.
    const under = tryLock(
      { ...spent, legCount: CONFIG.maxLegsPerSession - 1 },
      "2026-08-03T17:20:00.000Z",
      "2026-08-03T17:02:00.000Z"
    );
    expect(under.lifecycle.origin).not.toBeNull();
    expect(under.lifecycle.legCount).toBe(CONFIG.maxLegsPerSession);
  });
});

describe("one alert per bar", () => {
  /** A bar strong enough to confirm AND take out a level at once. */
  function busyBar(previous: TrendLifecycle) {
    return advanceLifecycle({
      previous,
      facts: factsWith({
        price: 102,
        vwap: { value: 99, above: true, reclaimedAt: null },
        atr5m: 0.5,
        fromOriginDollars: 1,
        fromOriginPct: 1,
        adversePivots: [],
        levels: [{ name: "Premarket high", price: 101, availableFrom: null }],
      }),
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T17:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 100.5,
      evaluable: true,
    });
  }

  it("collapses non-exempt transitions to the most significant", () => {
    // Already at trend_watch, so TAP 1 is not among this bar's output and
    // the collapse is purely between trend_confirmed and level_break.
    const out = busyBar({
      ...emptyLifecycle(),
      stage: "trend_watch",
      origin: LIVE_ORIGIN,
      setupKey: "k",
      structureStop: 100,
      transitions: [
        { stage: "trend_watch", marketDataAt: "2026-08-03T16:00:00.000Z", reason: "entered" },
      ],
    });

    // PRECONDITION: the bar really did record more than one transition,
    // so this is a collapse and not an empty bar.
    expect(out.lifecycle.transitions.length).toBeGreaterThan(2);
    expect(out.newTransitions).toHaveLength(1);
    expect(out.newTransitions[0].stage).toBe("level_break");
  });

  it("never swallows TAP 1, even when a bigger alert lands on the same bar", () => {
    // Entering from idle: this bar records trend_watch AND the bigger
    // events. Real AAPL 2026-07-13 reported a level break as its first
    // alert of the session and never announced TAP 1 at all.
    const out = busyBar({
      ...emptyLifecycle(),
      stage: "idle",
      origin: LIVE_ORIGIN,
      setupKey: "k",
      structureStop: 100,
    });

    const stages = out.newTransitions.map((t) => t.stage);
    expect(stages).toContain("trend_watch");
    // The bigger event still gets through too.
    expect(stages).toContain("level_break");
    // ...but the rest is still collapsed: trend_confirmed loses to
    // level_break, so exactly two alerts leave this bar.
    expect(out.newTransitions).toHaveLength(2);
    // TAP 1 reads as the heads-up that PRECEDED the entry.
    expect(stages[0]).toBe("trend_watch");
  });
});

describe("bearish alerts read bearish", () => {
  const shortOrigin = {
    mode: "held_base" as const,
    price: 100,
    establishedAt: "2026-08-03T13:35:00.000Z",
    invalidationPrice: 101,
  };

  function shortLifecycle(overrides: Partial<TrendLifecycle> = {}): TrendLifecycle {
    return {
      ...emptyLifecycle(),
      stage: "level_break",
      origin: shortOrigin,
      setupKey: "k",
      structureStop: 100,
      transitions: [
        { stage: "trend_watch", marketDataAt: "2026-08-03T13:40:00.000Z", reason: "entered" },
      ],
      ...overrides,
    };
  }

  function advanceShort(previous: TrendLifecycle, facts: TrendFacts, blueSky: number | null) {
    return advanceLifecycle({
      previous,
      facts,
      direction: "bearish",
      config: CONFIG,
      marketDataAt: "2026-08-03T17:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: blueSky,
      previousClose: facts.price === null ? null : facts.price + 0.1,
      evaluable: true,
    });
  }

  it("calls a structure break a LOWER HIGH closed ABOVE", () => {
    // For a short, price rising through the stop is the break.
    const out = advanceShort(
      shortLifecycle(),
      factsWith({ price: 100.5, atr5m: 0.5, adversePivots: [], levels: [] }),
      null
    );
    const failed = out.newTransitions.find((t) => t.stage === "failed");
    expect(failed?.reason).toContain("closed above the lower high");
    expect(failed?.reason).not.toContain("higher low");
  });

  it("calls a fresh extreme a NEW-LOW continuation", () => {
    const out = advanceShort(
      shortLifecycle(),
      factsWith({ price: 95, atr5m: 0.5, adversePivots: [], levels: [] }),
      95.2
    );
    const fire = out.newTransitions.find((t) => t.reason.includes("continuation"));
    expect(fire?.reason).toContain("New-low");
    expect(fire?.reason).not.toContain("New-high");
  });

  it("calls the continuation pivot a LOWER HIGH", () => {
    const facts = factsWith({
      price: 96,
      atr5m: 0.5,
      // For a short the adverse pivots are swing HIGHS, and 98 is a
      // LOWER high than the 100 origin.
      adversePivots: [{ name: "Pivot high", price: 98, availableFrom: "2026-08-03T15:00:00.000Z" }],
      levels: [{ name: "Pivot low", price: 97, availableFrom: "2026-08-03T14:30:00.000Z" }],
    });
    const out = advanceShort(shortLifecycle(), facts, null);
    const fire = out.newTransitions.find((t) => t.reason.startsWith("Continuation"));
    expect(fire?.reason).toContain("lower high at 98.00");
    expect(fire?.reason).not.toContain("higher low");
  });

  it("names the wrong side of the 1m 9 EMA as BELOW for a short", () => {
    const out = advanceShort(
      shortLifecycle({ stage: "basing", origin: null, structureStop: null }),
      factsWith({
        price: 99,
        atr5m: 0.5,
        adversePivots: [],
        levels: [],
        // Wrong side for a short.
        oneMinuteEma9: { value: 98, above: false, rising: false },
      }),
      null
    );
    const requirements = out.blockers.map((b) => b.requirement);
    expect(requirements).toContain("Below the 1m 9 EMA");
    expect(requirements).toContain("1m 9 EMA turning down");
    expect(requirements).not.toContain("Above the 1m 9 EMA");
  });
});

// ---------------------------------------------------------------------------
// `extended` IS RECORDED BUT NEVER ALERTED
//
// It is a caution state — its own reason ends "stretched, not a signal" —
// so alerting on it asks the reader to act on something the detector has
// just told them not to act on. The stage and every downstream behaviour
// stay exactly as they were.
// ---------------------------------------------------------------------------

describe("extended is a state, not an alert", () => {
  /** Well past the extension threshold, with the ride otherwise healthy. */
  function stretchedFacts(): TrendFacts {
    return factsWith({
      price: 110,
      vwap: { value: 99, above: true, reclaimedAt: null },
      atr5m: 0.5,
      fromOriginDollars: 10,
      fromOriginPct: 10,
      // Comfortably beyond `extendedAtrFromFiveMinuteEma`.
      atrFromFiveMinuteEma: CONFIG.extendedAtrFromFiveMinuteEma + 1,
      levels: [],
      adversePivots: [],
    });
  }

  function advanceStretched(previous: TrendLifecycle) {
    return advanceLifecycle({
      previous,
      facts: stretchedFacts(),
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T17:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 109.5,
      evaluable: true,
    });
  }

  it("reaches the extended stage but emits no alert for it", () => {
    // Already entered and confirmed, so `extended` is the only thing left
    // this bar can newly record.
    const previous: TrendLifecycle = {
      ...liveLifecycle(),
      transitions: [
        { stage: "trend_watch", marketDataAt: "2026-08-03T16:00:00.000Z", reason: "entered" },
        { stage: "trend_confirmed", marketDataAt: "2026-08-03T16:30:00.000Z", reason: "confirmed" },
      ],
    };
    const out = advanceStretched(previous);

    // PRECONDITION: the stage really was reached and recorded in history,
    // so the empty alert list below is suppression and not absence.
    expect(out.lifecycle.transitions.some((t) => t.stage === "extended")).toBe(true);
    expect(out.lifecycle.stage).toBe("extended");

    // ...but nothing was emitted for it.
    expect(out.newTransitions.some((t) => t.stage === "extended")).toBe(false);
  });

  it("still alerts everything else on a bar that also went extended", () => {
    // A bar that records BOTH a real level break and `extended`: the
    // level break must survive, only `extended` is dropped.
    const previous: TrendLifecycle = {
      ...liveLifecycle(),
      transitions: [
        { stage: "trend_watch", marketDataAt: "2026-08-03T16:00:00.000Z", reason: "entered" },
      ],
    };
    const facts = factsWith({
      price: 110,
      vwap: { value: 99, above: true, reclaimedAt: null },
      atr5m: 0.5,
      fromOriginDollars: 10,
      fromOriginPct: 10,
      atrFromFiveMinuteEma: CONFIG.extendedAtrFromFiveMinuteEma + 1,
      levels: [{ name: "Premarket high", price: 108, availableFrom: null }],
      adversePivots: [],
    });
    const out = advanceLifecycle({
      previous,
      facts,
      direction: "bullish",
      config: CONFIG,
      marketDataAt: "2026-08-03T17:00:00.000Z",
      candidateOrigin: null,
      hasBasingCandidate: false,
      blueSkyReference: null,
      previousClose: 107.5,
      evaluable: true,
    });

    expect(out.lifecycle.transitions.some((t) => t.stage === "extended")).toBe(true);
    expect(out.newTransitions.some((t) => t.stage === "extended")).toBe(false);
    expect(out.newTransitions.some((t) => t.reason.includes("premarket high"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// THE OPENING WINDOW
//
// A 14-period ATR on 5m bars needs ~15 completed REGULAR bars, and both
// origin paths open with a hard `no_atr` refusal, so for the first ~70
// minutes no origin could lock at all. Real MU 2026-07-31 had a lower-high
// base at 928.60 lockable at 09:35 and the detector could not touch it
// until 10:40, by which point price was 8.1% lower.
//
// During that window only, the paths scale by the premarket-INCLUSIVE
// ATR -- real bars, never a fabricated default.
// ---------------------------------------------------------------------------

/** 90 premarket minutes that DECLINE, so no bullish base qualifies. */
function decliningPremarket(): Candle[] {
  const bars: Candle[] = [];
  for (let i = 0; i < 90; i++) {
    const p = 110 - i * 0.11;
    bars.push(preBar(90 - i, p, p + 0.25, p - 0.3, p - 0.05));
  }
  return bars;
}

/**
 * 50 REGULAR minutes -- only 10 completed 5m bars, so the regular ATR is
 * still unmeasurable -- containing a higher-low base that forms AFTER the
 * bell: a 99.60 low, a rally to ~103, a 100.50 higher low, then a hold.
 */
function regularBaseAfterTheBell(): Candle[] {
  const bars: Candle[] = [];
  let i = 0;
  bars.push(bar(i++, 100.0, 100.2, 99.6, 99.9)); // session extreme
  for (let k = 0; k < 8; k++) {
    const up = 100.1 + k * 0.36;
    bars.push(bar(i++, up, up + 0.3, up - 0.15, up + 0.25)); // rally to ~103
  }
  bars.push(bar(i++, 102.8, 102.9, 100.5, 100.7)); // the higher low
  for (let k = 0; k < 6; k++) {
    const hold = 100.8 + k * 0.2;
    bars.push(bar(i++, hold, hold + 0.25, hold - 0.15, hold + 0.18)); // holds
  }
  while (i < 50) {
    const up = 102.2 + (i - 15) * 0.03;
    bars.push(bar(i++, up, up + 0.2, up - 0.1, up + 0.12));
  }
  return bars;
}

/**
 * Supplies premarket FIVE-minute bars but no premarket one-minute bars.
 *
 * That combination disables Fix #1's premarket base path outright (it
 * needs the 1m series) while still leaving a real premarket-inclusive
 * ATR measurable -- which isolates THIS fix: the regular-session path
 * getting a volatility scale it otherwise would not have.
 */
function evaluateInOpeningWindow(premarket: Candle[] | undefined) {
  // The base lookback is 30 completed 1m bars, so evaluate while the base
  // is still inside it rather than after it has scrolled out.
  const regularOne = regularBaseAfterTheBell().slice(0, 20);
  const regularFive = agg5(regularOne);
  return evaluateTrend({
    symbol: "TEST",
    direction: "bullish",
    tradingDate: DATE,
    oneMinute: regularOne,
    fiveMinute: regularFive,
    daily: [],
    levels: [{ name: "Premarket high", price: 110.5, availableFrom: null }],
    premarketLevel: { name: "Premarket high", price: 110.5, availableFrom: null },
    // Deliberately NO premarket 1m: the premarket base path cannot run,
    // so anything that locks here locks through the regular path.
    premarketOneMinute: undefined,
    premarketFiveMinute: premarket === undefined ? undefined : agg5(premarket),
    relativeVolume: okVolume,
    relativeToBenchmark: null,
    relativeToSector: null,
    previous: emptyLifecycle(),
    config: CONFIG,
    evaluatedAt: new Date((regularFive[regularFive.length - 1].time + 300) * 1000),
    pivotLength: 3,
    feedLabel: "test",
  });
}

describe("opening-window volatility scale", () => {
  it("has no measurable REGULAR ATR in this window — the precondition", () => {
    const regularFive = agg5(regularBaseAfterTheBell().slice(0, 20));
    // Fewer than the ~15 completed 5m bars a 14-period ATR needs.
    expect(regularFive.length).toBeLessThan(15);
    expect(latestValid(calculateAtr(regularFive, 14))).toBeNull();
  });

  it("lets the REGULAR path lock on premarket-inclusive ATR while the regular ATR is null", () => {
    const out = evaluateInOpeningWindow(decliningPremarket());
    const origin = out.result.lifecycle.origin;
    // The claim under test is that an origin can lock AT ALL in a window
    // where the regular ATR is null and both paths therefore used to
    // refuse. Which candidate in the base wins is fixture trivia, and
    // pinning it would test the fixture rather than the rule.
    expect(origin).not.toBeNull();
    expect(Number.isFinite(origin!.price)).toBe(true);
    expect(origin!.invalidationPrice).toBeLessThan(origin!.price);
  });

  it("stays NULL when no ATR is measurable from any source", () => {
    // PRECONDITION: with premarket bars the identical fixture DOES lock,
    // so the null below is the missing volatility scale and nothing else.
    expect(evaluateInOpeningWindow(decliningPremarket()).result.lifecycle.origin).not.toBeNull();

    const out = evaluateInOpeningWindow(undefined);
    expect(out.result.lifecycle.origin).toBeNull();
    // Reported honestly rather than silently: the 5m ATR is named as
    // unavailable, never substituted with a default.
    expect(out.result.unavailable).toContain("5-minute ATR");
  });

  it("leaves facts.atr5m itself unmeasured — the scale is for ORIGIN only", () => {
    const out = evaluateInOpeningWindow(decliningPremarket());
    // The confirmation threshold, the extension measure and the milestone
    // ladder must keep scaling by REGULAR volatility, which is still null
    // here. Borrowing premarket range for those would silently move every
    // downstream threshold.
    expect(out.result.facts.atr5m).toBeNull();
  });
});
