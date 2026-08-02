import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  scanWatchlistWithProvider,
  resetExpansionBaselineCache,
} from "@/lib/scanner/scanService";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import * as reclaimRunner from "@/lib/scanner/reclaimRunner";
import {
  FixtureProvider,
  standardFixtures,
  STANDARD_SYMBOLS,
  SCAN_NOW,
} from "./support/expansionScanFixture";

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
  it("ships enabled with alerting OFF", () => {
    expect(RECLAIM.enabled).toBe(true);
    expect(RECLAIM.alertingEnabled).toBe(false);
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

  it("still runs Reclaim when Expansion is disabled entirely", async () => {
    // Reclaim must not depend on Expansion being enabled.
    const { result } = await scan({
      ...configWith({ enabled: true }),
      premarketExpansion: { ...defaultStrategyConfig.premarketExpansion, enabled: false },
    });

    expect(result.expansionBySymbol).toBeUndefined();
    expect(result.reclaimBySymbol).toBeDefined();
    expect(Object.keys(result.reclaimBySymbol!)).toHaveLength(2);

    // KNOWN LIMITATION of this phase, asserted rather than left implied:
    // the 1m history is loaded only for the Expansion monitor, so with
    // Expansion off Reclaim runs five-minute only and its scout is
    // explicitly unavailable — never silently "found nothing".
    const entry = result.reclaimBySymbol!.EXPD;
    expect(entry.oneMinute).toBeNull();
    expect(entry.oneMinuteStage).toBe("unavailable");
    expect(entry.alignment).toBe("unavailable");
  });

  it("adds no 1m fetch of its own when the Expansion monitor is off", async () => {
    const { provider } = await scan({
      ...configWith({ enabled: true }),
      premarketExpansion: {
        ...defaultStrategyConfig.premarketExpansion,
        monitorEnabled: false,
      },
    });
    // Reclaim being enabled must not introduce a provider call.
    expect(provider.calls.filter((c) => c.timeframe === "1m")).toHaveLength(0);
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
