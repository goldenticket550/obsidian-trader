import { describe, it, expect, vi } from "vitest";
import {
  detectBenchmarkAlignment,
  resolveBenchmarkSymbol,
} from "@/lib/indicators/benchmarkAlignment";
import { selectClosestGap } from "@/lib/indicators/fairValueGap";
import type { FairValueGap } from "@/lib/indicators/fairValueGap";
import {
  scanWatchlistWithProvider,
  resetExpansionBaselineCache,
} from "@/lib/scanner/scanService";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { scoreSetup } from "@/lib/strategies/scorer";
import { makeCandle, flatSeries, risingSeries } from "@/lib/fixtures/candles";
import type { Candle } from "@/types/candle";
import type { MarketDataProvider } from "@/lib/market-data/types";

function gap(lower: number, upper: number, status: FairValueGap["status"] = "open"): FairValueGap {
  return { lower, upper, createdAt: 0, candle1Time: 0, candle3Time: 600, status };
}

describe("Rule C2 — rank multiple gaps, surface the closest", () => {
  it("returns nulls and a zero count when no gaps qualify", () => {
    const r = selectClosestGap([], 100);
    expect(r.closest).toBeNull();
    expect(r.distance).toBeNull();
    expect(r.totalGapsTracked).toBe(0);
  });

  it("picks the closest of three gaps by midpoint distance, not the first found", () => {
    const gaps = [gap(80, 82), gap(98, 100), gap(120, 122)];
    const r = selectClosestGap(gaps, 100);
    // Midpoints 81, 99, 121 -> distances 19, 1, 21.
    expect(r.closest!.lower).toBe(98);
    expect(r.distance).toBeCloseTo(1, 5);
    expect(r.totalGapsTracked).toBe(3);
  });

  it("still picks the closest when the first in the array is nearest", () => {
    const r = selectClosestGap([gap(98, 100), gap(60, 62)], 100);
    expect(r.closest!.lower).toBe(98);
  });

  it("uses the positive filter — only open and partially_filled qualify", () => {
    const gaps = [
      gap(99, 101, "fully_filled"),
      gap(98, 100, "invalidated"),
      gap(70, 72, "open"),
      gap(60, 62, "partially_filled"),
    ];
    const r = selectClosestGap(gaps, 100);
    // The two nearest are excluded by status; nearest qualifying is 70-72.
    expect(r.closest!.lower).toBe(70);
    expect(r.totalGapsTracked).toBe(2);
  });

  it("counts only qualifying gaps in totalGapsTracked", () => {
    expect(selectClosestGap([gap(1, 2, "fully_filled")], 100).totalGapsTracked).toBe(0);
  });
});

describe("Rule C1 — fair value gap is optional, not required", () => {
  const base = {
    symbol: "TEST" as const,
    timeframe: "5m" as const,
    dailyCandles: flatSeries(25, 100),
    prevClose: 100,
    config: defaultStrategyConfig,
    now: "2026-01-01T00:00:00Z",
    quality: "simulated" as const,
  };

  it("no longer gates status — required count is 6, and fvg is not among them", () => {
    const result = scoreSetup({ ...base, sessionCandles: risingSeries(20, 100, 1) });
    const required = result.conditions.filter((c) => c.required);
    expect(required).toHaveLength(6);
    expect(required.map((c) => c.id)).not.toContain("fair_value_gap");
  });

  it("keeps the fvg condition present, and still secondary category", () => {
    const result = scoreSetup({ ...base, sessionCandles: risingSeries(20, 100, 1) });
    const fvg = result.conditions.find((c) => c.id === "fair_value_gap")!;
    expect(fvg).toBeDefined();
    expect(fvg.required).toBe(false);
    expect(fvg.category).toBe("secondary");
  });

  it("leaves gap_proximity optional/informational, as it already was", () => {
    const result = scoreSetup({ ...base, sessionCandles: risingSeries(20, 100, 1) });
    const prox = result.conditions.find((c) => c.id === "gap_proximity")!;
    expect(prox.required).toBe(false);
    expect(prox.category).toBe("informational");
  });
});

describe("Rule D2 — benchmark symbol resolution", () => {
  it("defaults the whole watchlist to QQQ", () => {
    expect(defaultStrategyConfig.benchmarkAlignment.defaultBenchmark).toBe("QQQ");
    expect(resolveBenchmarkSymbol("AAPL", defaultStrategyConfig.benchmarkAlignment)).toBe("QQQ");
  });

  it("honours a per-symbol override", () => {
    const cfg = { defaultBenchmark: "QQQ", overrides: { NVDA: "SMH", AMD: "SMH" } };
    expect(resolveBenchmarkSymbol("NVDA", cfg)).toBe("SMH");
    expect(resolveBenchmarkSymbol("AAPL", cfg)).toBe("QQQ");
  });
});

describe("Rule D1 — benchmark alignment", () => {
  const EMA_PERIOD = defaultStrategyConfig.emaReclaim.period;

  /** Rising series: price ends above both its VWAP and its EMA. */
  function alignedSeries(): Candle[] {
    return risingSeries(40, 100, 1);
  }
  /** Falling series: price ends below both. */
  function misalignedSeries(): Candle[] {
    return risingSeries(40, 100, 1).reverse().map((c, i) => ({ ...c, time: i * 300 }));
  }

  it("reports insufficientData — never 'not aligned' — when candles are missing", () => {
    const r = detectBenchmarkAlignment("QQQ", [], EMA_PERIOD);
    expect(r.insufficientData).toBe(true);
    expect(r.aligned).toBe(false);
    expect(r.passed).toBe(false);
    expect(r.benchmarkPrice).toBeNull();
  });

  it("reports insufficientData when there are too few candles for the EMA", () => {
    const r = detectBenchmarkAlignment("QQQ", risingSeries(3, 100, 1), EMA_PERIOD);
    expect(r.insufficientData).toBe(true);
  });

  it("passes when the benchmark is above BOTH its VWAP and its 9 EMA", () => {
    const r = detectBenchmarkAlignment("QQQ", alignedSeries(), EMA_PERIOD);
    expect(r.insufficientData).toBe(false);
    expect(r.aligned).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.benchmarkPrice).toBeGreaterThan(r.benchmarkVwap!);
    expect(r.benchmarkPrice).toBeGreaterThan(r.benchmarkEma!);
  });

  it("fails when the benchmark is not above both", () => {
    const r = detectBenchmarkAlignment("QQQ", misalignedSeries(), EMA_PERIOD);
    expect(r.insufficientData).toBe(false);
    expect(r.aligned).toBe(false);
  });

  it("names the benchmark and reports its real values in the detail", () => {
    const r = detectBenchmarkAlignment("SMH", alignedSeries(), EMA_PERIOD);
    expect(r.benchmarkSymbol).toBe("SMH");
    expect(r.detail).toContain("SMH");
    expect(r.detail).toContain(r.benchmarkPrice!.toFixed(2));
  });
});

describe("Rule D — shared benchmark fetch efficiency", () => {
  /** Records every symbol requested so duplicate fetches are visible. */
  function countingProvider(): { provider: MarketDataProvider; calls: string[] } {
    const calls: string[] = [];
    const provider: MarketDataProvider = {
      name: "counting",
      async getCandles({ symbol, timeframe }) {
        calls.push(symbol);
        const candles =
          timeframe === "1d"
            ? [
                makeCandle({ time: Math.floor(new Date("2026-07-30T20:00:00Z").getTime() / 1000), open: 100, high: 100, low: 96, close: 97 }),
              ]
            : risingSeries(40, 100, 1);
        return { symbol, timeframe, quality: "delayed", candles };
      },
      async getSessionInfo() {
        return { isOpen: true, session: "regular", nextOpenTime: null };
      },
    };
    return { provider, calls };
  }

  /**
   * The efficiency guarantee is that benchmark cost is per unique
   * benchmark per CYCLE, never per symbol.
   *
   * It is deliberately expressed as "does not scale with symbol count"
   * rather than as a fixed request count: the Premarket Expansion
   * Candidate needs two further shared benchmark series (today's
   * premarket, and daily for the prior close), so the per-benchmark
   * bundle is larger than it was — but a fourth symbol mapped to SMH
   * still adds nothing.
   */
  it("fetches a shared benchmark ONCE per scan, not once per symbol", async () => {
    const config = {
      ...defaultStrategyConfig,
      benchmarkAlignment: {
        defaultBenchmark: "QQQ",
        overrides: { NVDA: "SMH", AMD: "SMH", MU: "SMH" },
      },
    };

    const one = countingProvider();
    resetExpansionBaselineCache();
    await scanWatchlistWithProvider(
      [{ symbol: "NVDA", exchange: "NASDAQ" }],
      one.provider,
      config,
      "2026-07-31T14:00:00Z"
    );

    const three = countingProvider();
    resetExpansionBaselineCache();
    await scanWatchlistWithProvider(
      [
        { symbol: "NVDA", exchange: "NASDAQ" },
        { symbol: "AMD", exchange: "NASDAQ" },
        { symbol: "MU", exchange: "NASDAQ" },
      ],
      three.provider,
      config,
      "2026-07-31T14:00:00Z"
    );

    const smhOne = one.calls.filter((s) => s === "SMH").length;
    const smhThree = three.calls.filter((s) => s === "SMH").length;
    expect(smhOne).toBeGreaterThan(0);
    // Three symbols sharing SMH cost exactly what one symbol costs.
    expect(smhThree).toBe(smhOne);
  });

  it("fetches each distinct benchmark once", async () => {
    const { provider, calls } = countingProvider();
    const config = {
      ...defaultStrategyConfig,
      benchmarkAlignment: { defaultBenchmark: "QQQ", overrides: { NVDA: "SMH" } },
    };

    resetExpansionBaselineCache();
    await scanWatchlistWithProvider(
      [
        { symbol: "NVDA", exchange: "NASDAQ" },
        { symbol: "AAPL", exchange: "NASDAQ" },
      ],
      provider,
      config,
      "2026-07-31T14:00:00Z"
    );

    // Each benchmark's bundle is fetched once, and the two benchmarks
    // cost the same as each other — neither is fetched per symbol.
    const smh = calls.filter((s) => s === "SMH").length;
    const qqq = calls.filter((s) => s === "QQQ").length;
    expect(smh).toBeGreaterThan(0);
    expect(qqq).toBe(smh);
  });

  it("spends no benchmark premarket or daily requests when expansion is disabled", async () => {
    const { provider, calls } = countingProvider();
    const config = {
      ...defaultStrategyConfig,
      benchmarkAlignment: { defaultBenchmark: "QQQ", overrides: {} },
      premarketExpansion: { ...defaultStrategyConfig.premarketExpansion, enabled: false },
    };

    resetExpansionBaselineCache();
    await scanWatchlistWithProvider(
      [{ symbol: "AAPL", exchange: "NASDAQ" }],
      provider,
      config,
      "2026-07-31T14:00:00Z"
    );

    // Exactly the pre-integration cost: one 5m regular fetch.
    expect(calls.filter((s) => s === "QQQ")).toHaveLength(1);
  });
});

/**
 * The proof that Rule C1 actually changed what it claims to: a setup
 * where every one of the six remaining required conditions passes while
 * NO fair value gap ever forms. Before C1 this was impossible — fvg was
 * required, so "no gap" capped the setup at yellow forever.
 *
 * Lows deliberately overlap throughout, so no 3-candle gap
 * (candle3.low > candle1.high) can form anywhere in the series.
 */
function greenWithoutAnyGap(): Candle[] {
  const c: Candle[] = [];
  let t = 0;
  const push = (o: number, h: number, l: number, cl: number, v = 2000) => {
    c.push({ time: t, open: o, high: h, low: l, close: cl, volume: v });
    t += 300;
  };
  let p = 110;
  for (let i = 0; i < 10; i++) { const cl = p - 1; push(p, p + 0.3, cl - 0.5, cl, 1000); p = cl; }
  push(100, 100.5, 98.8, 99.5, 1500);      // sweep below the developing low
  push(99.5, 101.0, 98.9, 100.6, 1800);    // reclaim it
  push(100.6, 101.8, 99.6, 101.4, 1600);
  push(101.4, 102.6, 100.2, 102.3, 1700);
  push(102.3, 103.6, 101.0, 103.3, 2000);
  push(103.3, 104.8, 102.0, 104.5, 2500);
  push(104.5, 105.8, 103.0, 105.5, 2600);
  push(105.5, 105.9, 103.8, 104.4, 1400);  // becomes the pivot high (105.9)
  push(104.4, 104.9, 103.2, 103.9, 1300);  // pivotLength 3 needs three
  push(103.9, 105.0, 103.0, 104.2, 1250);  // lower highs on each side
  push(104.2, 105.4, 103.5, 105.0, 2100);
  push(105.0, 106.6, 104.0, 106.2, 2400);  // closes above 105.9 -> shift
  push(106.2, 108.0, 105.2, 107.5, 2900);
  return c;
}

describe("Rule C1 — green is now genuinely reachable with no gap at all", () => {
  const result = scoreSetup({
    symbol: "TEST",
    timeframe: "5m",
    sessionCandles: greenWithoutAnyGap(),
    dailyCandles: flatSeries(25, 100),
    prevClose: 100,
    config: defaultStrategyConfig,
    now: "2026-01-01T00:00:00Z",
    quality: "simulated",
  });

  it("has no fair value gap at all", () => {
    expect(result.conditions.find((c) => c.id === "fair_value_gap")!.state).toBe("waiting");
  });

  it("still reaches green, with all six required conditions passing", () => {
    const required = result.conditions.filter((c) => c.required);
    expect(required).toHaveLength(6);
    expect(required.every((c) => c.state === "pass")).toBe(true);
    expect(result.status).toBe("green");
  });

  it("reports confirmed conviction and stage despite the missing gap", () => {
    expect(result.convictionLevel).toBe("confirmed");
    expect(result.stage).toBe("confirmed");
  });
});

describe("sessionScope plumbing — premarket can now be requested", () => {
  it("defaults to today's existing behavior when omitted", async () => {
    const seen: (string | undefined)[] = [];
    const provider: MarketDataProvider = {
      name: "scope-probe",
      async getCandles(params) {
        seen.push(params.sessionScope);
        return { symbol: params.symbol, timeframe: params.timeframe, quality: "delayed", candles: [] };
      },
      async getSessionInfo() {
        return { isOpen: true, session: "regular", nextOpenTime: null };
      },
    };

    await provider.getCandles({ symbol: "X", timeframe: "5m" });
    expect(seen[0]).toBeUndefined(); // omitted -> provider applies "regular"
  });

  it("scanService requests an extended-scope series for Rule A2", async () => {
    const scopes: (string | undefined)[] = [];
    const provider: MarketDataProvider = {
      name: "scope-probe",
      async getCandles(params) {
        scopes.push(params.sessionScope);
        const candles =
          params.timeframe === "1d"
            ? [makeCandle({ time: Math.floor(new Date("2026-07-30T20:00:00Z").getTime() / 1000), open: 100, high: 100, low: 96, close: 97 })]
            : risingSeries(40, 100, 1);
        return { symbol: params.symbol, timeframe: params.timeframe, quality: "delayed", candles };
      },
      async getSessionInfo() {
        return { isOpen: true, session: "regular", nextOpenTime: null };
      },
    };

    await scanWatchlistWithProvider(
      [{ symbol: "NVDA", exchange: "NASDAQ" }],
      provider,
      defaultStrategyConfig,
      "2026-07-31T14:00:00Z"
    );

    expect(scopes).toContain("extended");
  });
});
