import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  scanWatchlistWithProvider,
  resetExpansionBaselineCache,
} from "@/lib/scanner/scanService";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import * as reclaimRunner from "@/lib/scanner/reclaimRunner";
import * as liquiditySweep from "@/lib/indicators/liquiditySweep";
import * as structureShift from "@/lib/indicators/structureShift";
import {
  FixtureProvider,
  standardFixtures,
  STANDARD_SYMBOLS,
  SCAN_NOW,
  SCAN_NOW_MIDDAY,
  MIDDAY_LAST_BAR_MINUTE,
  EXPANDING,
  TODAY_TRADING_DATE,
  etTime,
} from "./support/expansionScanFixture";
import {
  structureAndSweepSeries,
  waitingStructureSeries,
} from "./support/structureSweepFixture";

/**
 * Reclaim & Continuation wired into the scan path — EVALUATION MODE.
 *
 * The whole point of this phase: the result is computed and exposed for
 * display, and NOTHING alerts. Every test below is either about that, or
 * about the wiring being unable to damage anything else.
 */

const RECLAIM = defaultStrategyConfig.reclaimContinuation;

function configWith(patch: Partial<StrategyConfig["reclaimContinuation"]>): StrategyConfig {
  return {
    ...defaultStrategyConfig,
    reclaimContinuation: { ...RECLAIM, ...patch },
  };
}

beforeEach(() => {
  resetExpansionBaselineCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function scan(config: StrategyConfig, provider = new FixtureProvider(standardFixtures())) {
  const result = await scanWatchlistWithProvider(STANDARD_SYMBOLS, provider, config, SCAN_NOW);
  return { result, provider };
}

// ---------------------------------------------------------------------------
// The shipped defaults
// ---------------------------------------------------------------------------

describe("shipped defaults", () => {
  it("ships enabled with alerting ON", () => {
    expect(RECLAIM.enabled).toBe(true);
    expect(RECLAIM.alertingEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// enabled: false
// ---------------------------------------------------------------------------

describe("enabled: false", () => {
  it("produces no Reclaim field at all", async () => {
    const { result } = await scan(configWith({ enabled: false }));
    expect(result.reclaimBySymbol).toBeUndefined();
    expect(result.reclaimErrors).toBeUndefined();
  });

  it("does no Reclaim work — the runner is never invoked", async () => {
    const spy = vi.spyOn(reclaimRunner, "runReclaimForSymbol");
    await scan(configWith({ enabled: false }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("leaves the reversal and Expansion output untouched", async () => {
    const off = await scan(configWith({ enabled: false }));
    const on = await scan(configWith({ enabled: true }));

    expect(off.result.watchlist).toEqual(on.result.watchlist);
    expect(off.result.resultsBySymbol).toEqual(on.result.resultsBySymbol);
    expect(off.result.expansionBySymbol).toEqual(on.result.expansionBySymbol);
    expect(off.result.expansionMonitorBySymbol).toEqual(on.result.expansionMonitorBySymbol);
  });
});

// ---------------------------------------------------------------------------
// enabled: true, alertingEnabled: false — evaluation mode
// ---------------------------------------------------------------------------

describe("evaluation mode", () => {
  it("exposes a Reclaim result for every scanned symbol", async () => {
    const { result } = await scan(configWith({ enabled: true, alertingEnabled: false }));

    expect(result.reclaimBySymbol).toBeDefined();
    expect(Object.keys(result.reclaimBySymbol!).sort()).toEqual(["CALM", "EXPD"]);
    for (const entry of Object.values(result.reclaimBySymbol!)) {
      expect(entry.symbol).toBeDefined();
      expect(entry.alertTier).toBeDefined();
      // The headline is always the five-minute machine.
      expect(entry.stage).toBeDefined();
    }
  });

  it("emits ZERO alerts — the payload carries no Reclaim alert of any kind", async () => {
    const withReclaim = await scan(configWith({ enabled: true, alertingEnabled: false }));
    const withoutReclaim = await scan(configWith({ enabled: false }));

    // Nothing alert-shaped is produced by the Reclaim path: the scan
    // output is byte-identical apart from the additive display field.
    const strip = (r: Awaited<ReturnType<typeof scan>>["result"]) => {
      const { reclaimBySymbol, reclaimErrors, ...rest } = r;
      void reclaimBySymbol;
      void reclaimErrors;
      return rest;
    };
    expect(strip(withReclaim.result)).toEqual(strip(withoutReclaim.result));

    // And there is no alert surface on the result at all.
    expect(Object.keys(withReclaim.result)).not.toContain("newAlerts");
    expect(JSON.stringify(withReclaim.result.reclaimBySymbol)).not.toMatch(
      /alert_event|notification|queued/i
    );
  });

  it("writes no persistent alert or notification, whatever the tier says", async () => {
    const { result } = await scan(configWith({ enabled: true, alertingEnabled: false }));

    // No alert-shaped surface exists on the scan output.
    expect(Object.keys(result)).not.toContain("newAlerts");
    expect(Object.keys(result)).not.toContain("reclaimAlerts");
    expect(JSON.stringify(result.reclaimBySymbol)).not.toMatch(
      /alert_event|notification|queued|delivered/i
    );
    // Even a symbol whose tier is actionable emits nothing.
    for (const entry of Object.values(result.reclaimBySymbol!)) {
      expect(entry).not.toHaveProperty("alert");
      expect(entry).not.toHaveProperty("notification");
    }
  });

  it("reads alertingEnabled only in config plumbing and the one emission file", async () => {
    // A static guard, because the runtime assertions above can only show
    // what happens on THIS fixture. NARROWED, not removed, when the alert
    // path was wired: exactly one emission file may read the flag, so a
    // second decision point anywhere in lib/, app/ or components/ fails
    // this test rather than quietly widening where alerting is decided.
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");

    const root = resolve(__dirname, "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.tsx?$/.test(name) ? [full] : [];
      });

    const readers = ["lib", "app", "components"]
      .flatMap((d) => walk(join(root, d)))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        // Comments mention the flag by design; only real reads count.
        return /(?<!\/[/*].*)\balertingEnabled\b/.test(
          source
            .split("\n")
            .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
            .join("\n")
        );
      })
      .map((f) => f.replace(root, "").replace(/\\/g, "/"));

    // Where the flag is DECLARED, VALIDATED, and acted on — and nowhere
    // else. The emission file is the single decision point; the routes
    // call it without reading the flag themselves, and neither the
    // detector, the runner, nor any component may consult it.
    expect(readers.sort()).toEqual([
      "/lib/alerts/reclaimAlerts.ts",
      "/lib/strategies/config.ts",
      "/lib/strategies/reclaimContinuationConfig.ts",
    ]);
  });

  it("computes the tier but keeps it display-only", async () => {
    const { result } = await scan(configWith({ enabled: true, alertingEnabled: false }));
    for (const entry of Object.values(result.reclaimBySymbol!)) {
      // The rules-derived tier is still calculated — evaluation mode
      // changes emission, never the calculation.
      expect(["none", "early", "monitor", "review_now"]).toContain(entry.alertTier);
    }
  });

  it("produces identical Reclaim output whichever way alertingEnabled is set", async () => {
    // alertingEnabled must never reach the detector or the runner.
    const off = await scan(configWith({ alertingEnabled: false }));
    resetExpansionBaselineCache();
    const on = await scan(configWith({ alertingEnabled: true }));
    expect(on.result.reclaimBySymbol).toEqual(off.result.reclaimBySymbol);
  });
});

// ---------------------------------------------------------------------------
// Failure isolation
// ---------------------------------------------------------------------------

describe("failure isolation", () => {
  it("a thrown Reclaim error leaves the rest of the scan identical", async () => {
    const clean = await scan(configWith({ enabled: false }));

    vi.spyOn(reclaimRunner, "runReclaimForSymbol").mockImplementation(() => {
      throw new Error("reclaim exploded");
    });
    const broken = await scan(configWith({ enabled: true }));

    // Reversal and Expansion are untouched by the explosion.
    expect(broken.result.watchlist).toEqual(clean.result.watchlist);
    expect(broken.result.resultsBySymbol).toEqual(clean.result.resultsBySymbol);
    expect(broken.result.expansionBySymbol).toEqual(clean.result.expansionBySymbol);
    expect(broken.result.expansionMonitorBySymbol).toEqual(
      clean.result.expansionMonitorBySymbol
    );

    // `errors` means "symbol excluded from the scan" — a Reclaim failure
    // is not that.
    expect(broken.result.errors).toEqual([]);
    // The failure is reported separately, and Reclaim is simply absent.
    expect(broken.result.reclaimErrors?.map((e) => e.symbol).sort()).toEqual(["CALM", "EXPD"]);
    expect(broken.result.reclaimBySymbol).toEqual({});
  });

  it("costs only the failing symbol its Reclaim field", async () => {
    let calls = 0;
    const real = reclaimRunner.runReclaimForSymbol;
    vi.spyOn(reclaimRunner, "runReclaimForSymbol").mockImplementation((input, config) => {
      calls += 1;
      if (calls === 1) throw new Error("first symbol only");
      return real(input, config);
    });

    const { result } = await scan(configWith({ enabled: true }));
    expect(result.reclaimErrors).toHaveLength(1);
    // The neighbouring symbol still produced a result.
    expect(Object.keys(result.reclaimBySymbol!)).toHaveLength(1);
    expect(result.watchlist).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Data reuse — no extra fetch
// ---------------------------------------------------------------------------

describe("data reuse", () => {
  it("adds no provider call when Reclaim is enabled alongside Expansion", async () => {
    const off = await scan(configWith({ enabled: false }));
    resetExpansionBaselineCache();
    const on = await scan(configWith({ enabled: true }));

    expect(on.provider.calls).toHaveLength(off.provider.calls.length);
    // Specifically: the 1m history is fetched exactly once per symbol,
    // whether or not Reclaim is consuming it.
    const oneMinuteCalls = (p: FixtureProvider) =>
      p.calls.filter((c) => c.timeframe === "1m").length;
    expect(oneMinuteCalls(on.provider)).toBe(oneMinuteCalls(off.provider));
  });

  it("reuses the shared one-minute history rather than fetching its own", async () => {
    const { result, provider } = await scan(configWith({ enabled: true }));

    // One 1m fetch per symbol, and the Reclaim scout still has data.
    expect(provider.calls.filter((c) => c.timeframe === "1m")).toHaveLength(2);
    const entry = result.reclaimBySymbol!.EXPD;
    expect(entry.oneMinute === null || entry.oneMinuteStage !== undefined).toBe(true);
  });

  it("still runs Reclaim when Expansion is disabled entirely, WITH its scout", async () => {
    // Reclaim must not depend on Expansion being enabled — neither for
    // running at all, nor for having one-minute data.
    const { result, provider } = await scan({
      ...configWith({ enabled: true }),
      premarketExpansion: { ...defaultStrategyConfig.premarketExpansion, enabled: false },
    });

    expect(result.expansionBySymbol).toBeUndefined();
    expect(result.reclaimBySymbol).toBeDefined();
    expect(Object.keys(result.reclaimBySymbol!)).toHaveLength(2);

    // The shared history is now fetched for Reclaim in its own right —
    // one request per symbol — where previously Expansion being off meant
    // Reclaim had no one-minute data at all.
    //
    // NOT asserted here: that the scout reaches an active stage. This
    // fixture's regular session is flat and produces no qualifying reset
    // on either timeframe, so `oneMinute` is null for reasons that have
    // nothing to do with data availability. The fetch is the claim.
    expect(provider.calls.filter((c) => c.timeframe === "1m")).toHaveLength(2);
  });

  // -------------------------------------------------------------------
  // Shared one-minute history — the three enablement combinations
  // -------------------------------------------------------------------

  const oneMinuteCalls = (p: FixtureProvider) =>
    p.calls.filter((c) => c.timeframe === "1m");

  it("BOTH enabled: one 1m request per symbol, not two", async () => {
    // Two consumers of the same data must not cost two fetches.
    const { provider } = await scan(configWith({ enabled: true }));
    expect(oneMinuteCalls(provider)).toHaveLength(2);
    // And it really is one per symbol, not two for one symbol.
    expect(new Set(oneMinuteCalls(provider).map((c) => c.symbol))).toEqual(
      new Set(["EXPD", "CALM"])
    );
  });

  it("RECLAIM ONLY: one 1m request per symbol", async () => {
    const { provider } = await scan({
      ...configWith({ enabled: true }),
      premarketExpansion: {
        ...defaultStrategyConfig.premarketExpansion,
        monitorEnabled: false,
      },
    });
    expect(oneMinuteCalls(provider)).toHaveLength(2);
  });

  it("BOTH disabled: no 1m request at all", async () => {
    const { provider } = await scan({
      ...configWith({ enabled: false }),
      premarketExpansion: {
        ...defaultStrategyConfig.premarketExpansion,
        monitorEnabled: false,
      },
    });
    expect(oneMinuteCalls(provider)).toHaveLength(0);
  });

  it("one symbol's 1m failure does not suppress another symbol", async () => {
    const provider = new FixtureProvider(standardFixtures());
    const realGet = provider.getCandles.bind(provider);
    vi.spyOn(provider, "getCandles").mockImplementation(async (params) => {
      if (params.symbol === "CALM" && params.timeframe === "1m") {
        throw new Error("fixture: no 1m for CALM");
      }
      return realGet(params);
    });

    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      configWith({ enabled: true }),
      SCAN_NOW
    );

    // Both symbols still produce a Reclaim result, and the throwing
    // symbol costs nothing beyond its own scout.
    expect(Object.keys(result.reclaimBySymbol!).sort()).toEqual(["CALM", "EXPD"]);
    expect(result.reclaimBySymbol!.CALM.oneMinute).toBeNull();
    expect(result.reclaimBySymbol!.CALM.oneMinuteStage).toBe("unavailable");
    // The healthy symbol's request was still made and still succeeded.
    expect(
      provider.calls.filter((c) => c.timeframe === "1m" && c.symbol === "EXPD")
    ).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.reclaimErrors ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Honest inputs
// ---------------------------------------------------------------------------

describe("input sourcing", () => {
  it("passes unavailable inputs as null, never as zero", async () => {
    const { result } = await scan(configWith({ enabled: true }));
    const entry = result.reclaimBySymbol!.EXPD;

    // These have no existing source in the scan pipeline yet, so they are
    // explicitly unavailable rather than fabricated.
    if (entry.fiveMinute !== null) {
      expect(entry.fiveMinute.volumePace).toBeNull();
      expect(entry.fiveMinute.benchmarkRelativeMove).toBeNull();
      expect(entry.fiveMinute.structureLevel).toBeNull();
      expect(entry.fiveMinute.volumePace).not.toBe(0);
    }
  });

  /**
   * Captures the input every symbol's runner call received, without
   * changing what the runner does.
   */
  function captureRunnerInputs() {
    const inputs: reclaimRunner.ReclaimRunnerInput[] = [];
    const real = reclaimRunner.runReclaimForSymbol;
    vi.spyOn(reclaimRunner, "runReclaimForSymbol").mockImplementation((input, cfg) => {
      inputs.push(input);
      return real(input, cfg);
    });
    return inputs;
  }

  it("sources the prior day's high and low as a directional pair", async () => {
    const inputs = captureRunnerInputs();
    await scan(configWith({ enabled: true }));

    const expd = inputs.find((i) => i.symbol === "EXPD")!;
    expect(expd.priorDayLevel).toEqual({
      high: EXPANDING.dailyHigh,
      low: EXPANDING.dailyLow,
    });
    // Precondition: the two sides differ, so a single-price bug would be
    // visible here rather than hidden by coincidence.
    expect(EXPANDING.dailyHigh).not.toBe(EXPANDING.dailyLow);
  });

  it("sources the premarket session high and low as a directional pair", async () => {
    const inputs = captureRunnerInputs();
    await scan(configWith({ enabled: true }));

    const expd = inputs.find((i) => i.symbol === "EXPD")!;
    expect(expd.premarketLevel).not.toBeNull();
    const { high, low } = expd.premarketLevel!;
    expect(high).toBeGreaterThan(low!);
    // The fixture's premarket runs from 100 upward with a drift of 4 and a
    // one-point bar range, so the band must contain that span.
    expect(low!).toBeLessThanOrEqual(EXPANDING.todayShape.open);
    expect(high!).toBeGreaterThanOrEqual(
      EXPANDING.todayShape.open + EXPANDING.todayShape.drift
    );
  });

  it("withholds the opening range until its window has actually closed", async () => {
    // At 9:35 only the first bar has completed — the five-minute opening
    // range window is not yet behind us in one-minute bars.
    const inputs = captureRunnerInputs();
    await scan(configWith({ enabled: true }));

    const expd = inputs.find((i) => i.symbol === "EXPD")!;
    expect(expd.openingRangeLevel).toBeNull();
  });

  it("supplies the opening range high and low once the window is complete", async () => {
    const inputs = captureRunnerInputs();
    const provider = new FixtureProvider(standardFixtures(), MIDDAY_LAST_BAR_MINUTE);
    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      configWith({ enabled: true }),
      SCAN_NOW_MIDDAY
    );

    const expd = inputs.find((i) => i.symbol === "EXPD")!;
    expect(expd.openingRangeLevel).not.toBeNull();
    const { high, low } = expd.openingRangeLevel!;
    expect(high).not.toBeNull();
    expect(low).not.toBeNull();
    expect(high!).toBeGreaterThan(low!);
  });

  it("never invents a prior-day level, because a symbol without one is excluded first", async () => {
    const inputs = captureRunnerInputs();
    // A symbol whose daily series carries today only. The reversal scanner
    // already requires a previous close, so this symbol never reaches the
    // Reclaim runner — which is why `priorDayLevel` has no fabricated
    // fallback: the unavailable case is unreachable by construction.
    const provider = new FixtureProvider(standardFixtures());
    const realGet = provider.getCandles.bind(provider);
    vi.spyOn(provider, "getCandles").mockImplementation(async (params) => {
      const series = await realGet(params);
      if (params.timeframe !== "1d") return series;
      return { ...series, candles: series.candles.slice(-1) };
    });

    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      configWith({ enabled: true }),
      SCAN_NOW
    );

    expect(result.errors.map((e) => e.symbol).sort()).toEqual(["CALM", "EXPD"]);
    expect(inputs).toHaveLength(0);
    expect(result.reclaimBySymbol).toEqual({});
  });

  it("reports an unavailable premarket as null, not as zero", async () => {
    const inputs = captureRunnerInputs();
    const provider = new FixtureProvider(standardFixtures({ EXPD: { extendedFails: true } }));

    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      configWith({ enabled: true }),
      SCAN_NOW
    );

    const expd = inputs.find((i) => i.symbol === "EXPD");
    // Either the symbol produced no Reclaim input at all, or its premarket
    // level is honestly absent — never a zero standing in for a price.
    if (expd) {
      expect(expd.premarketLevel === null || expd.premarketLevel.high !== 0).toBe(true);
      expect(expd.premarketLevel).not.toEqual({ high: 0, low: 0 });
    }
  });

  /**
   * A provider that serves a session with a real structure shift and a
   * real liquidity sweep for the FIVE-MINUTE regular request — the exact
   * series the scan both scores and hands to the Reclaim runner.
   *
   * Only the response content differs; the request set is untouched, so
   * this cannot introduce a fetch.
   */
  function sweepingProvider() {
    const provider = new FixtureProvider(standardFixtures(), MIDDAY_LAST_BAR_MINUTE);
    const realGet = provider.getCandles.bind(provider);
    vi.spyOn(provider, "getCandles").mockImplementation(async (params) => {
      const series = await realGet(params);
      if (params.timeframe !== "5m" || params.sessionScope !== undefined) return series;
      return {
        ...series,
        candles: structureAndSweepSeries(etTime(TODAY_TRADING_DATE, 9 * 60 + 30)),
      };
    });
    return provider;
  }

  it("sources the structure level from the scored SetupResult's evidence", async () => {
    const inputs = captureRunnerInputs();
    const provider = sweepingProvider();
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      configWith({ enabled: true }),
      SCAN_NOW_MIDDAY
    );

    const evidence = result.resultsBySymbol.EXPD["5m"].evidence!;
    // Precondition: this session really did produce a CONFIRMED structure
    // shift, so both the level and its availability time are real.
    expect(evidence.structureShift.state).toBe("confirmed");
    expect(evidence.structureShift.triggerSwingHigh).not.toBeNull();

    const expd = inputs.find((i) => i.symbol === "EXPD")!;
    // The swing high is RESISTANCE, so it is the bullish side only.
    expect(expd.structureLevel).toEqual({
      high: evidence.structureShift.triggerSwingHigh,
      low: null,
    });
    // ...and it carries the bar the PIVOT completed on, so the detector
    // cannot reclaim it earlier than that.
    expect(expd.structureAvailableFromTime).toBe(
      evidence.structureShift.triggerSwingHighConfirmedTime
    );
    expect(expd.structureAvailableFromTime).not.toBeNull();

    // Availability is strictly EARLIER than the shift bar. Dating it from
    // the shift would put availability after price had already closed
    // above the level, so the below→above crossing could never be seen.
    expect(expd.structureAvailableFromTime!).toBeLessThan(
      evidence.structureShift.shiftCandleTime!
    );
  });

  it("supplies a dated structure level even while the shift is still 'waiting'", async () => {
    // A swing high is real as soon as its pivot completes — price does not
    // have to have closed above it yet. Because the level now carries the
    // bar it became knowable from, the "waiting" state needs no special
    // gating: the date IS the honesty guarantee.
    const inputs = captureRunnerInputs();
    const provider = new FixtureProvider(standardFixtures(), MIDDAY_LAST_BAR_MINUTE);
    const realGet = provider.getCandles.bind(provider);
    vi.spyOn(provider, "getCandles").mockImplementation(async (params) => {
      const series = await realGet(params);
      if (params.timeframe !== "5m" || params.sessionScope !== undefined) return series;
      return {
        ...series,
        candles: waitingStructureSeries(etTime(TODAY_TRADING_DATE, 9 * 60 + 30)),
      };
    });

    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      configWith({ enabled: true }),
      SCAN_NOW_MIDDAY
    );

    const evidence = result.resultsBySymbol.EXPD["5m"].evidence!.structureShift;
    // Precondition: genuinely waiting, with a real swing high.
    expect(evidence.state).toBe("waiting");
    expect(evidence.shiftCandleTime).toBeNull();
    expect(evidence.triggerSwingHigh).not.toBeNull();

    const expd = inputs.find((i) => i.symbol === "EXPD")!;
    expect(expd.structureLevel).toEqual({ high: evidence.triggerSwingHigh, low: null });
    expect(expd.structureAvailableFromTime).toBe(evidence.triggerSwingHighConfirmedTime);
    expect(expd.structureAvailableFromTime).not.toBeNull();
  });

  it("keeps the level and its availability date together — both or neither", async () => {
    const inputs = captureRunnerInputs();
    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      sweepingProvider(),
      configWith({ enabled: true }),
      SCAN_NOW_MIDDAY
    );

    for (const input of inputs) {
      // A level without a date would be a hindsight price; a date without
      // a level is meaningless. Neither may occur alone.
      expect(input.structureLevel === null).toBe(input.structureAvailableFromTime === null);
    }
  });

  it("supplies no structure level when the session forms no swing-high pivot", async () => {
    // The standard flat fixture produces no pivot high at all.
    const inputs = captureRunnerInputs();
    const { result } = await scan(configWith({ enabled: true }));

    const evidence = result.resultsBySymbol.EXPD["5m"].evidence!.structureShift;
    expect(evidence.triggerSwingHigh).toBeNull();
    expect(evidence.triggerSwingHighConfirmedTime).toBeNull();

    const expd = inputs.find((i) => i.symbol === "EXPD")!;
    expect(expd.structureLevel).toBeNull();
    expect(expd.structureAvailableFromTime).toBeNull();
  });

  it("never fills the bearish structure side, because no bearish detector exists", async () => {
    const inputs = captureRunnerInputs();
    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      sweepingProvider(),
      configWith({ enabled: true }),
      SCAN_NOW_MIDDAY
    );

    for (const input of inputs) {
      // A support level would have to come from a detector this repo does
      // not have. Null, never the resistance level relabelled.
      expect(input.structureLevel?.low ?? null).toBeNull();
    }
  });

  it("builds sweep evidence from the scored result, tagged bullish", async () => {
    const inputs = captureRunnerInputs();
    const provider = sweepingProvider();
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      provider,
      configWith({ enabled: true }),
      SCAN_NOW_MIDDAY
    );

    const sweep = result.resultsBySymbol.EXPD["5m"].evidence!.liquiditySweep;
    // Precondition: a real sweep, not an empty one matching an empty map.
    expect(sweep.passed).toBe(true);

    const expd = inputs.find((i) => i.symbol === "EXPD")!;
    expect(expd.sweepEvidence).toEqual({
      // The repo's detector is bullish-only; the direction is a constant,
      // not an inference from the data.
      direction: "bullish",
      sweptLevel: sweep.sweptLevel,
      sweepCandleTime: sweep.sweepCandleTime,
      reclaimCandleTime: sweep.reclaimCandleTime,
    });
  });

  it("never synthesizes a bearish sweep", async () => {
    const inputs = captureRunnerInputs();
    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      sweepingProvider(),
      configWith({ enabled: true }),
      SCAN_NOW_MIDDAY
    );

    for (const input of inputs) {
      if (input.sweepEvidence !== null) {
        expect(input.sweepEvidence.direction).toBe("bullish");
      }
    }
  });

  it("passes null when the session produced no sweep and no structure level", async () => {
    // The standard fixture's flat regular session sweeps nothing and forms
    // no swing high — absent, not zero.
    const inputs = captureRunnerInputs();
    const { result } = await scan(configWith({ enabled: true }));

    const evidence = result.resultsBySymbol.EXPD["5m"].evidence!;
    // Precondition: the detectors genuinely found nothing here.
    expect(evidence.liquiditySweep.passed).toBe(false);
    expect(evidence.structureShift.triggerSwingHigh).toBeNull();

    const expd = inputs.find((i) => i.symbol === "EXPD")!;
    expect(expd.structureLevel).toBeNull();
    expect(expd.sweepEvidence).toBeNull();
    // Explicitly not a fabricated flat level or a zero-priced sweep.
    expect(expd.structureLevel).not.toEqual({ high: 0, low: 0 });
  });

  it("calls no detector a second time — the values come off the scored result", async () => {
    const sweepSpy = vi.spyOn(liquiditySweep, "detectLiquiditySweep");
    const structureSpy = vi.spyOn(structureShift, "detectStructureShift");

    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      sweepingProvider(),
      configWith({ enabled: true }),
      SCAN_NOW_MIDDAY
    );

    // scoreSetup runs once per timeframe per symbol (5m and 15m), and the
    // Reclaim wiring adds none: two symbols x two timeframes.
    expect(sweepSpy).toHaveBeenCalledTimes(4);
    expect(structureSpy).toHaveBeenCalledTimes(4);
  });

  it("sources levels without adding a single provider call", async () => {
    const off = await scan(configWith({ enabled: false }));
    resetExpansionBaselineCache();
    const on = await scan(configWith({ enabled: true }));

    expect(on.provider.calls).toHaveLength(off.provider.calls.length);
    expect(on.provider.calls.map((c) => `${c.symbol}:${c.timeframe}:${c.sessionScope ?? ""}`))
      .toEqual(off.provider.calls.map((c) => `${c.symbol}:${c.timeframe}:${c.sessionScope ?? ""}`));
  });

  it("uses a five-minute ATR, not the daily one", async () => {
    const { result } = await scan(configWith({ enabled: true }));
    const entry = result.reclaimBySymbol!.EXPD;

    if (entry.fiveMinute !== null && entry.fiveMinute.resetAtr !== null) {
      // A daily ATR on this fixture is orders of magnitude larger than the
      // 5m one, so a daily yardstick would collapse resetAtr toward zero.
      expect(entry.fiveMinute.resetAtr).toBeGreaterThan(0);
      expect(Number.isFinite(entry.fiveMinute.resetAtr)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The one-minute scout must not be able to blank the five-minute machine
// ---------------------------------------------------------------------------

describe("a failed one-minute fetch does not disable Reclaim", () => {
  /**
   * REGRESSION (live, 2026-08-03). Reclaim's freshness was read from the
   * ONE-MINUTE history:
   *
   *   freshness: oneMinuteHistory?.freshness.status ?? null
   *
   * A 1m fetch that throws is swallowed to `oneMinuteHistory = null`, so
   * freshness became null, which `freshnessAllowsEvaluation` rejects,
   * which returned `unavailable` for the FIVE-minute machine as well — a
   * machine that never reads 1m data.
   *
   * Observed in an exported evaluation log: at 15:20:06Z all eleven
   * symbols had full reads (AMZN acceptance, GOOGL review_now); 69
   * seconds later at 15:21:15Z every one was "unavailable" with every
   * field null. Eleven symbols do not all invalidate at once — the 1m
   * fetch had failed, most likely on a rate limit.
   */
  function providerWithFailing1m() {
    const provider = new FixtureProvider(standardFixtures());
    const realGet = provider.getCandles.bind(provider);
    vi.spyOn(provider, "getCandles").mockImplementation(async (params) => {
      if (params.timeframe === "1m") throw new Error("429 rate limited");
      return realGet(params);
    });
    return provider;
  }

  /** Captures what the runner was actually handed. */
  function captureInputs() {
    const inputs: reclaimRunner.ReclaimRunnerInput[] = [];
    const real = reclaimRunner.runReclaimForSymbol;
    vi.spyOn(reclaimRunner, "runReclaimForSymbol").mockImplementation((input, cfg) => {
      inputs.push(input);
      return real(input, cfg);
    });
    return inputs;
  }

  it("still hands the runner a real freshness when the 1m fetch fails", async () => {
    const inputs = captureInputs();
    await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      providerWithFailing1m(),
      configWith({ enabled: true }),
      SCAN_NOW
    );

    // Precondition: the runner really was invoked, so an empty loop
    // cannot pass this vacuously.
    expect(inputs.length).toBeGreaterThan(0);

    for (const input of inputs) {
      // A null here is exactly what re-introduces the defect: it blocks
      // evaluation for every symbol at once, whatever the 5m data says.
      expect(input.freshness).not.toBeNull();
      expect(["real_time", "delayed"]).toContain(input.freshness);
    }
  });

  it("produces the SAME five-minute read with and without the 1m fetch", async () => {
    const healthy = await scan(configWith({ enabled: true }));
    resetExpansionBaselineCache();
    const degraded = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      providerWithFailing1m(),
      configWith({ enabled: true }),
      SCAN_NOW
    );

    for (const symbol of Object.keys(healthy.result.reclaimBySymbol!)) {
      const before = healthy.result.reclaimBySymbol![symbol];
      const after = degraded.reclaimBySymbol![symbol];
      // The five-minute machine is the system of record and does not
      // read 1m data, so losing the scout must not change its verdict.
      expect(after.stage).toBe(before.stage);
      expect(after.fiveMinute?.unavailableReason ?? null).toBe(
        before.fiveMinute?.unavailableReason ?? null
      );
    }
  });

  it("never blocks the five-minute machine on freshness when 5m bars are fresh", async () => {
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      providerWithFailing1m(),
      configWith({ enabled: true }),
      SCAN_NOW
    );

    for (const entry of Object.values(result.reclaimBySymbol!)) {
      // Whatever else it says, it must not claim the DATA was too stale
      // to look at — the five-minute series was right there.
      expect(entry.fiveMinute?.unavailableReason).not.toBe("freshness_blocked");
    }
  });

  it("reports the missing scout precisely, rather than by erasure", async () => {
    const result = await scanWatchlistWithProvider(
      STANDARD_SYMBOLS,
      providerWithFailing1m(),
      configWith({ enabled: true }),
      SCAN_NOW
    );

    for (const entry of Object.values(result.reclaimBySymbol!)) {
      expect(entry.oneMinute).toBeNull();
      expect(entry.oneMinuteStage).toBe("unavailable");
      expect(entry.alignment).toBe("unavailable");
    }
  });
});
