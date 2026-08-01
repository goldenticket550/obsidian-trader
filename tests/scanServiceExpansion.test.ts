import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import {
  scanWatchlistWithProvider,
  resetExpansionBaselineCache,
} from "@/lib/scanner/scanService";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import { EXPANSION_STAGE_PRIORITY } from "@/lib/scanner/expansionPriority";
import {
  FixtureProvider,
  standardFixtures,
  EXPANDING,
  STANDARD_SYMBOLS,
  SCAN_NOW,
  SCAN_NOW_MIDDAY,
  MIDDAY_LAST_BAR_MINUTE,
  TODAY_TRADING_DATE,
} from "./support/expansionScanFixture";

/**
 * Feature A integration: the Premarket Expansion Candidate runs inside the
 * live scan path and reports per-symbol results.
 *
 * Deliberately NOT covered here, because they are not part of this step:
 * dashboard rendering, alerting, one-minute early acceleration, and
 * expansion-stage ordering.
 */

const CONFIG_WITH_EXPANSION = defaultStrategyConfig;

function configWith(patch: Partial<StrategyConfig["premarketExpansion"]>): StrategyConfig {
  return {
    ...defaultStrategyConfig,
    premarketExpansion: { ...defaultStrategyConfig.premarketExpansion, ...patch },
  };
}

beforeEach(() => {
  resetExpansionBaselineCache();
});

describe("premarket expansion runs in the live scan path", () => {
  it("populates expansionBySymbol for a symbol with enough premarket and baseline data", async () => {
    const provider = new FixtureProvider(standardFixtures());
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    expect(result.expansionBySymbol).toBeDefined();
    expect(Object.keys(result.expansionBySymbol!).sort()).toEqual(["CALM", "EXPD"]);

    const expanding = result.expansionBySymbol!.EXPD;
    expect(expanding.bullish.symbol).toBe("EXPD");
    expect(expanding.bullish.direction).toBe("bullish");
    expect(expanding.bearish.direction).toBe("bearish");
  });

  it("reports a clearly expanding bullish premarket as qualified", async () => {
    const provider = new FixtureProvider(standardFixtures());
    const { expansionBySymbol } = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    const bullish = expansionBySymbol!.EXPD.bullish;
    expect(bullish.qualified).toBe(true);
    // Both corroborating groups are measured, not merely assumed available.
    expect(bullish.volumePace.state).toBe("pass");
    expect(bullish.rangeExpansion.state).toBe("pass");
    expect(bullish.corroboratingGroupPassed).toBe(true);
    expect(bullish.passingGroups).toBeGreaterThanOrEqual(3);
    // The baseline really was built from the historical cache, not skipped.
    expect(bullish.volumePace.baselineSampleSize).toBe(20);
    expect(bullish.volumePace.multiple).toBeGreaterThan(1.5);
    // Freshness permitted the candidate, and the dataset was complete.
    expect(bullish.freshness.status).toBe("real_time");
  });

  it("leaves an ordinary symbol unqualified rather than manufacturing a candidate", async () => {
    const provider = new FixtureProvider(standardFixtures());
    const { expansionBySymbol } = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    const calm = expansionBySymbol!.CALM;
    expect(calm.bullish.qualified).toBe(false);
    expect(calm.bearish.qualified).toBe(false);
    expect(calm.bullish.corroboratingGroupPassed).toBe(false);
  });

  it("evaluates the bearish direction from the same fetched data", async () => {
    const provider = new FixtureProvider(
      standardFixtures({
        DROP: {
          priorShape: { open: 100, drift: -0.5, barRange: 0.25, volumePerBar: 1000 },
          todayShape: { open: 100, drift: -4, barRange: 1, volumePerBar: 4000 },
          dailyHigh: 102,
          dailyLow: 99,
          dailyClose: 100,
        },
      })
    );
    const { expansionBySymbol } = await scanWatchlistWithProvider(
      [{ symbol: "DROP", exchange: "NASDAQ" }],
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    expect(expansionBySymbol!.DROP.bearish.qualified).toBe(true);
    expect(expansionBySymbol!.DROP.bullish.qualified).toBe(false);
  });

  it("uses the shared benchmark fetch rather than one per symbol", async () => {
    const provider = new FixtureProvider(standardFixtures());
    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    // Two symbols both resolve to QQQ; the benchmark's regular, premarket
    // and daily series must each be fetched exactly once for the cycle.
    const qqqCalls = provider.callsFor("QQQ");
    expect(qqqCalls).toHaveLength(3);
    expect(
      qqqCalls.map((c) => `${c.timeframe}:${c.sessionScope ?? "regular"}`).sort()
    ).toEqual(["1d:regular", "5m:extended", "5m:regular"]);
  });

  it("fetches one historical baseline per symbol and reuses it across the cycle", async () => {
    const provider = new FixtureProvider(standardFixtures());
    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    for (const symbol of ["EXPD", "CALM"]) {
      const baselineCalls = provider
        .callsFor(symbol)
        .filter((c) => c.timeframe === "5m" && (c.sessionCount ?? 1) > 1);
      expect(baselineCalls).toHaveLength(1);
      expect(baselineCalls[0].sessionScope).toBe("extended");
      expect(baselineCalls[0].sessionCount).toBe(
        defaultStrategyConfig.premarketExpansion.lookbackSessions + 1
      );
      // Completeness plumbing: the cache can only report a missing today
      // if it is told which date today is.
      expect(baselineCalls[0].adjustment).toBe("raw");
    }
  });
});

describe("expansion failure never costs a symbol its reversal result", () => {
  it("degrades to unavailable, not absent, when the baseline fetch throws", async () => {
    const provider = new FixtureProvider(standardFixtures({ CALM: { baselineFails: true } }));
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    // The reversal path is completely unaffected.
    expect(result.watchlist.map((w) => w.ticker).sort()).toEqual(["CALM", "EXPD"]);
    expect(result.resultsBySymbol.CALM["5m"]).toBeDefined();
    expect(result.resultsBySymbol.CALM["15m"]).toBeDefined();
    // `errors` means "symbol excluded entirely" — an expansion failure is not that.
    expect(result.errors).toEqual([]);

    // The historical cache absorbs a provider failure into an explicitly
    // incomplete result rather than throwing, so the symbol still gets an
    // expansion entry — one that reports the data as unusable.
    const calm = result.expansionBySymbol!.CALM.bullish;
    expect(calm.freshness.status).toBe("partial");
    expect(calm.qualified).toBe(false);
    expect(calm.volumePace.state).toBe("unavailable");
    expect(calm.rangeExpansion.state).toBe("unavailable");
    // Its neighbour is entirely unaffected.
    expect(result.expansionBySymbol!.EXPD.bullish.qualified).toBe(true);
  });

  it("keeps every reversal result when the expansion evaluation itself throws", async () => {
    // An invalid threshold makes the detector's own config guard throw for
    // every symbol — the worst case for failure isolation.
    const provider = new FixtureProvider(standardFixtures());
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      configWith({ requiredConsecutiveCloses: 0 }),
      SCAN_NOW
    );

    expect(result.watchlist.map((w) => w.ticker).sort()).toEqual(["CALM", "EXPD"]);
    expect(result.resultsBySymbol.EXPD["5m"]).toBeDefined();
    expect(result.resultsBySymbol.CALM["15m"]).toBeDefined();
    expect(result.errors).toEqual([]);

    // No expansion results, and the reason is reported separately.
    expect(result.expansionBySymbol).toEqual({});
    expect(result.expansionErrors?.map((e) => e.symbol).sort()).toEqual(["CALM", "EXPD"]);
    expect(result.expansionErrors?.[0].message).toMatch(/Invalid premarketExpansion config/);
  });

  it("still reports a genuinely failed symbol in errors, as before", async () => {
    const provider = new FixtureProvider(standardFixtures({ CALM: { failsEntirely: true } }));
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    expect(result.watchlist.map((w) => w.ticker)).toEqual(["EXPD"]);
    expect(result.errors.map((e) => e.symbol)).toEqual(["CALM"]);
    expect(result.resultsBySymbol.CALM).toBeUndefined();
  });
});

describe("the reversal output is unchanged by the integration", () => {
  it("matches the output captured before scanService was touched", async () => {
    const baseline = JSON.parse(
      readFileSync(resolve(__dirname, "support/reversalBaseline.json"), "utf8")
    );

    const provider = new FixtureProvider(standardFixtures());
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    expect(result.watchlist).toEqual(baseline.watchlist);
    expect(result.resultsBySymbol).toEqual(baseline.resultsBySymbol);
    expect(result.errors).toEqual(baseline.errors);
  });

  it("produces identical reversal output whether expansion is on or off", async () => {
    const on = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      new FixtureProvider(standardFixtures()),
      configWith({ enabled: true }),
      SCAN_NOW
    );
    resetExpansionBaselineCache();
    const off = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      new FixtureProvider(standardFixtures()),
      configWith({ enabled: false }),
      SCAN_NOW
    );

    expect(off.watchlist).toEqual(on.watchlist);
    expect(off.resultsBySymbol).toEqual(on.resultsBySymbol);
  });
});

describe("the expansion evaluation is opt-out-able", () => {
  it("issues no baseline or benchmark-premarket requests when disabled", async () => {
    const provider = new FixtureProvider(standardFixtures());
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      configWith({ enabled: false }),
      SCAN_NOW
    );

    expect(result.expansionBySymbol).toBeUndefined();
    expect(result.expansionErrors).toBeUndefined();

    // Exactly the pre-integration request set: 4 per symbol plus one
    // shared benchmark 5m fetch.
    expect(provider.calls).toHaveLength(9);
    expect(provider.calls.filter((c) => (c.sessionCount ?? 1) > 1)).toHaveLength(0);
    expect(provider.callsFor("QQQ")).toHaveLength(1);
  });

  it("adds a bounded, documented request load when enabled", async () => {
    const provider = new FixtureProvider(standardFixtures());
    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      configWith({ enabled: true }),
      SCAN_NOW
    );

    // 9 as before, plus one 5m baseline per symbol (2), one 1m history per
    // symbol (2), and two more shared benchmark series (premarket + daily).
    expect(provider.calls).toHaveLength(15);
    expect(provider.calls.filter((c) => c.timeframe === "1m")).toHaveLength(2);
  });

  it("amortizes the baseline across scan cycles instead of refetching it", async () => {
    // The entire reason the historical cache is held at module level. A
    // per-call instance would re-pull ~21 sessions per symbol every cycle.
    const provider = new FixtureProvider(standardFixtures());

    await scanWatchlistWithProvider(STANDARD_SYMBOLS, provider, CONFIG_WITH_EXPANSION, SCAN_NOW);
    const afterFirst = provider.calls.length;
    expect(afterFirst).toBe(15);

    await scanWatchlistWithProvider(STANDARD_SYMBOLS, provider, CONFIG_WITH_EXPANSION, SCAN_NOW);
    const secondCycle = provider.calls.length - afterFirst;

    // Second cycle: 4 per-symbol series plus the 3 shared benchmark
    // series — and NO baseline refetch, 5m or 1m.
    expect(secondCycle).toBe(11);
    expect(
      provider.calls.slice(afterFirst).filter((c) => (c.sessionCount ?? 1) > 1)
    ).toHaveLength(0);
  });
});

describe("short history is gated by the baseline floor, not by freshness", () => {
  it("does not force a young symbol's candidate to partial", async () => {
    // Fifteen sessions: complete pagination, today present, simply a
    // symbol that has not existed for twenty-one sessions. That is a young
    // symbol, not truncated data — and its fourteen-session baseline
    // clears the ten-session floor comfortably.
    const provider = new FixtureProvider(
      standardFixtures({ EXPD: { ...EXPANDING, historySessions: 15 } })
    );
    const { expansionBySymbol } = await scanWatchlistWithProvider(
      [{ symbol: "EXPD", exchange: "NASDAQ" }],
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    const bullish = expansionBySymbol!.EXPD.bullish;
    expect(bullish.freshness.status).toBe("real_time");
    expect(bullish.volumePace.baselineSampleSize).toBe(14);
    expect(bullish.volumePace.state).toBe("pass");
    expect(bullish.qualified).toBe(true);
  });

  it("reports both baselines unavailable below the minimum session floor", async () => {
    // Six sessions: five prior, under the ten-session floor. The baselines
    // report why rather than inventing a multiple — no fabricated number
    // reaches the evidence groups.
    const provider = new FixtureProvider(
      standardFixtures({ EXPD: { ...EXPANDING, historySessions: 6 } })
    );
    const { expansionBySymbol } = await scanWatchlistWithProvider(
      [{ symbol: "EXPD", exchange: "NASDAQ" }],
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    const bullish = expansionBySymbol!.EXPD.bullish;
    expect(bullish.volumePace.state).toBe("unavailable");
    expect(bullish.volumePace.reason).toBe("insufficient_sessions");
    expect(bullish.volumePace.multiple).toBeNull();
    expect(bullish.rangeExpansion.state).toBe("unavailable");
    expect(bullish.rangeExpansion.multiple).toBeNull();

    // Neither corroborating BASELINE group can carry this candidate...
    const byName = Object.fromEntries(bullish.groups.map((g) => [g.name, g.state]));
    expect(byName.participation).toBe("unavailable");
    expect(byName.rangeExpansion).toBe("unavailable");

    // ...but an unavailable group is never a fail, so a real prior-day
    // level interaction can still corroborate. This is the module's
    // documented discipline, not a gap: qualification here rests on
    // measured facts, with the two baselines explicitly absent.
    expect(byName.priorDayInteraction).toBe("pass");
    expect(bullish.corroboratingGroupPassed).toBe(true);
  });

  it("still forces partial when the fetch was genuinely truncated", async () => {
    // Same short history, but the provider says its page chain was cut.
    // Truncation drops the NEWEST sessions, so this is not a young symbol.
    const provider = new FixtureProvider(
      standardFixtures({ EXPD: { ...EXPANDING, paginationComplete: false } })
    );
    const { expansionBySymbol } = await scanWatchlistWithProvider(
      [{ symbol: "EXPD", exchange: "NASDAQ" }],
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    const bullish = expansionBySymbol!.EXPD.bullish;
    expect(bullish.freshness.status).toBe("partial");
    expect(bullish.qualified).toBe(false);
  });
});

describe("benchmark series degrade independently", () => {
  /**
   * Run midday: Rule D needs eleven completed regular bars, so at the
   * 9:35 scan time its alignment is unevaluable whatever the benchmark
   * does — and a blanked benchmark series would be invisible.
   */
  function middayProvider(overrides: Parameters<typeof standardFixtures>[0] = {}) {
    return new FixtureProvider(standardFixtures(overrides), MIDDAY_LAST_BAR_MINUTE);
  }

  function alignmentOf(result: Awaited<ReturnType<typeof scanWatchlistWithProvider>>) {
    return result.resultsBySymbol.EXPD["5m"].conditions.find(
      (c) => c.id === "benchmark_alignment"
    )!;
  }

  it("evaluates Rule D at all when the benchmark is healthy (guards the test itself)", async () => {
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      middayProvider(),
      CONFIG_WITH_EXPANSION,
      SCAN_NOW_MIDDAY
    );
    expect(alignmentOf(result).insufficientData).toBe(false);
  });

  it("keeps the regular series when only the benchmark premarket fetch fails", async () => {
    // `regular` feeds Rule D on the REVERSAL path. An expansion-only fetch
    // failure must not blank it, or expansion-on and expansion-off would
    // produce different reversal scores for every symbol sharing this
    // benchmark.
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      middayProvider({ QQQ: { extendedFails: true } }),
      CONFIG_WITH_EXPANSION,
      SCAN_NOW_MIDDAY
    );

    expect(alignmentOf(result).insufficientData).toBe(false);
    // The expansion side reports the missing premarket honestly instead.
    expect(result.expansionBySymbol!.EXPD.bullish.relativeStrength.state).toBe("unavailable");
  });

  it("produces the same reversal benchmark result with expansion on and off", async () => {
    // The isolation this fix exists to protect, stated directly.
    const on = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      middayProvider({ QQQ: { extendedFails: true } }),
      configWith({ enabled: true }),
      SCAN_NOW_MIDDAY
    );
    resetExpansionBaselineCache();
    const off = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      middayProvider({ QQQ: { extendedFails: true } }),
      configWith({ enabled: false }),
      SCAN_NOW_MIDDAY
    );

    expect(on.resultsBySymbol).toEqual(off.resultsBySymbol);
    expect(on.watchlist).toEqual(off.watchlist);
  });

  it("still returns an empty bundle when the benchmark is entirely unavailable", async () => {
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      middayProvider({ QQQ: { failsEntirely: true } }),
      CONFIG_WITH_EXPANSION,
      SCAN_NOW_MIDDAY
    );

    // Degrades to "unknown", never to "not aligned", and the symbols still scan.
    expect(alignmentOf(result).insufficientData).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.watchlist).toHaveLength(2);
  });
});

describe("one-minute expansion monitor wiring", () => {
  it("populates expansionMonitorBySymbol alongside the five-minute candidate", async () => {
    const provider = new FixtureProvider(standardFixtures());
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    expect(result.expansionMonitorBySymbol).toBeDefined();
    const monitor = result.expansionMonitorBySymbol!.EXPD;
    expect(monitor.symbol).toBe("EXPD");
    // Direction-agnostic readings sit at the symbol level.
    expect(monitor.dollarVolume).toBeDefined();
    expect(monitor.momentumLadder).toBeDefined();
    // Directional readings are mirrored.
    expect(monitor.bullish.direction).toBe("bullish");
    expect(monitor.bearish.direction).toBe("bearish");
    expect(monitor.bullish.earlyAcceleration.type).toBe("early_acceleration");
    // The existing five-minute field is untouched.
    expect(result.expansionBySymbol!.EXPD.bullish.qualified).toBe(true);
  });

  it("measures the one-minute layer on real 1m bars and their own baseline", async () => {
    const provider = new FixtureProvider(standardFixtures());
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    const oneMinute = result.expansionMonitorBySymbol!.EXPD.oneMinute;
    expect(oneMinute.completedBarCount).toBeGreaterThan(0);
    expect(oneMinute.evaluationBarTime).not.toBeNull();
    expect(oneMinute.baselineSampleSize).toBeGreaterThan(0);
    expect(oneMinute.insufficientData).toBe(false);

    // A 1m fetch really was issued, separately from the 5m baseline.
    const oneMinuteFetches = provider
      .callsFor("EXPD")
      .filter((c) => c.timeframe === "1m" && (c.sessionCount ?? 1) > 1);
    expect(oneMinuteFetches).toHaveLength(1);
    expect(oneMinuteFetches[0].sessionScope).toBe("extended");
  });

  it("carries the resolved stage, keeping the five-minute base stage visible", async () => {
    const provider = new FixtureProvider(standardFixtures());
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    const bullish = result.expansionMonitorBySymbol!.EXPD.bullish;
    expect(bullish.baseStage).toBe(result.expansionBySymbol!.EXPD.bullish.stage);
    // Resolved never ranks below the base it came from.
    expect(EXPANSION_STAGE_PRIORITY[bullish.stage]).toBeGreaterThanOrEqual(
      EXPANSION_STAGE_PRIORITY[bullish.baseStage]
    );
    expect(bullish.signals).toBeDefined();
  });

  it("exposes the momentum ladder for the UI to render later", async () => {
    const provider = new FixtureProvider(standardFixtures());
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    const ladder = result.expansionMonitorBySymbol!.EXPD.momentumLadder;
    expect(ladder.tiers.map((t) => t.tierPct)).toEqual(
      [...defaultStrategyConfig.momentumLadder.tiers].sort((a, b) => a - b)
    );
  });

  it("issues no 1m requests and no monitor data when monitorEnabled is false", async () => {
    const provider = new FixtureProvider(standardFixtures());
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      configWith({ monitorEnabled: false }),
      SCAN_NOW
    );

    expect(result.expansionMonitorBySymbol).toBeUndefined();
    // The five-minute candidate is unaffected.
    expect(result.expansionBySymbol!.EXPD.bullish.qualified).toBe(true);
    expect(provider.calls.filter((c) => c.timeframe === "1m")).toHaveLength(0);
  });

  it("costs a symbol only its monitor data when the 1m fetch fails", async () => {
    // The provider rejects every 1-minute request for CALM.
    const provider = new FixtureProvider(standardFixtures());
    const original = provider.getCandles.bind(provider);
    provider.getCandles = async (params) => {
      if (params.symbol === "CALM" && params.timeframe === "1m") {
        throw new Error("fixture: no 1-minute history for CALM");
      }
      return original(params);
    };

    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    // Reversal and five-minute expansion both survive intact.
    expect(result.watchlist.map((w) => w.ticker).sort()).toEqual(["CALM", "EXPD"]);
    expect(result.resultsBySymbol.CALM["5m"]).toBeDefined();
    expect(result.errors).toEqual([]);
    expect(result.expansionBySymbol!.CALM).toBeDefined();

    // The monitor degrades for that symbol alone; its neighbour is fine.
    const calmMonitor = result.expansionMonitorBySymbol!.CALM;
    expect(calmMonitor.oneMinute.insufficientData).toBe(true);
    expect(calmMonitor.oneMinute.completedBarCount).toBe(0);
    expect(calmMonitor.bullish.earlyAcceleration.fired).toBe(false);
    // No fabricated stage promotion off missing data.
    expect(calmMonitor.bullish.stage).toBe(calmMonitor.bullish.baseStage);
    expect(result.expansionMonitorBySymbol!.EXPD.oneMinute.insufficientData).toBe(false);
  });

  it("leaves the reversal output identical whether the monitor runs or not", async () => {
    const on = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      new FixtureProvider(standardFixtures()),
      configWith({ monitorEnabled: true }),
      SCAN_NOW
    );
    resetExpansionBaselineCache();
    const off = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      new FixtureProvider(standardFixtures()),
      configWith({ monitorEnabled: false }),
      SCAN_NOW
    );

    expect(off.watchlist).toEqual(on.watchlist);
    expect(off.resultsBySymbol).toEqual(on.resultsBySymbol);
  });

  it("adds exactly one 1m fetch per symbol per cache fill", async () => {
    const provider = new FixtureProvider(standardFixtures());
    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );
    const firstCycle = provider.calls.length;

    // Second cycle: the 1m history is cached alongside the 5m baseline.
    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );
    const secondCycle = provider.calls.slice(firstCycle);

    expect(provider.calls.filter((c) => c.timeframe === "1m")).toHaveLength(2);
    expect(secondCycle.filter((c) => c.timeframe === "1m")).toHaveLength(0);
  });
});

describe("baseline completeness reaches the detector", () => {
  it("marks the dataset incomplete when today's session is missing from the history", async () => {
    // A truncated, oldest-first history is exactly the shape Findings 2/3
    // exist to catch: plenty of sessions, none of them today.
    const provider = new FixtureProvider(standardFixtures());
    const original = provider.getCandles.bind(provider);
    provider.getCandles = async (params) => {
      const series = await original(params);
      if ((params.sessionCount ?? 1) > 1) {
        const todayStart = Date.parse(`${TODAY_TRADING_DATE}T00:00:00Z`) / 1000;
        return { ...series, candles: series.candles.filter((c) => c.time < todayStart) };
      }
      return series;
    };

    const { expansionBySymbol } = await scanWatchlistWithProvider(
      [{ symbol: "EXPD", exchange: "NASDAQ" }],
      provider,
      CONFIG_WITH_EXPANSION,
      SCAN_NOW
    );

    const bullish = expansionBySymbol!.EXPD.bullish;
    expect(bullish.freshness.status).toBe("partial");
    expect(bullish.qualified).toBe(false);
    // Today's own window is absent, so the comparison cannot be made at all.
    expect(bullish.volumePace.state).toBe("unavailable");
  });
});
