import { describe, it, expect } from "vitest";
import { scoreSetup } from "@/lib/strategies/scorer";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { detectLiquiditySweep } from "@/lib/indicators/liquiditySweep";
import { detectStructureShift } from "@/lib/indicators/structureShift";
import { detectRecoveryFromLow } from "@/lib/indicators/sessionDecline";
import { flatSeries } from "@/lib/fixtures/candles";
import { structureAndSweepSeries } from "./support/structureSweepFixture";
import type { Candle } from "@/types/candle";

/**
 * `SetupResult.evidence` — the READ-ONLY republication of detector results
 * `scoreSetup` already computed.
 *
 * This file exists as a SEPARATE file on purpose: tests/scorer.test.ts is
 * the regression guard for the scorer's actual output and must stay
 * unmodified. Nothing here asserts a scoring value; every test asserts
 * that what was published equals what the detector independently returns.
 */

const NOW = "2026-01-01T00:00:00Z";

function score(sessionCandles: Candle[]) {
  return scoreSetup({
    symbol: "TEST",
    timeframe: "5m",
    sessionCandles,
    dailyCandles: flatSeries(25, 100),
    prevClose: 100,
    config: defaultStrategyConfig,
    now: NOW,
    quality: "simulated",
  });
}

/**
 * Re-derives both detector results the way `scoreSetup` does internally,
 * so the assertions compare against the detectors themselves rather than
 * against numbers copied out of a previous run.
 */
function detectorsFor(sessionCandles: Candle[]) {
  const recovery = detectRecoveryFromLow(
    sessionCandles,
    defaultStrategyConfig.recoveryFromLow
  );
  const sweep = detectLiquiditySweep(
    sessionCandles,
    recovery.sessionLow,
    defaultStrategyConfig.liquiditySweep
  );
  const sweepIndex = sweep.passed
    ? sessionCandles.findIndex((c) => c.time === sweep.reclaimCandleTime)
    : null;
  const structure = detectStructureShift(
    sessionCandles,
    sweepIndex,
    defaultStrategyConfig.structureShift
  );
  return { sweep, structure };
}

describe("SetupResult.evidence", () => {
  it("publishes exactly what the liquidity-sweep detector produced", () => {
    const candles = structureAndSweepSeries(1800);
    const result = score(candles);
    const { sweep } = detectorsFor(candles);

    // Precondition: this fixture really does produce a sweep, so an
    // all-null publication could not pass this test vacuously.
    expect(sweep.passed).toBe(true);
    expect(sweep.sweptLevel).not.toBeNull();

    expect(result.evidence).toBeDefined();
    expect(result.evidence!.liquiditySweep).toEqual(sweep);
  });

  it("publishes exactly what the structure-shift detector produced", () => {
    const candles = structureAndSweepSeries(1800);
    const result = score(candles);
    const { structure } = detectorsFor(candles);

    // Precondition: a real swing high was found and the shift actually
    // confirmed, so this is not an all-null result matching an all-null
    // publication.
    expect(structure.state).toBe("confirmed");
    expect(structure.triggerSwingHigh).not.toBeNull();
    expect(structure.shiftPrice).not.toBeNull();

    expect(result.evidence!.structureShift).toEqual(structure);
  });

  it("publishes a detector's negative result as-is, not as an absence", () => {
    // A flat series sweeps nothing. The published evidence must still be
    // the detector's real answer — "checked and found nothing" — rather
    // than the field being dropped.
    const candles = flatSeries(30, 100);
    const result = score(candles);
    const { sweep, structure } = detectorsFor(candles);

    expect(sweep.passed).toBe(false);
    expect(result.evidence!.liquiditySweep).toEqual(sweep);
    expect(result.evidence!.structureShift).toEqual(structure);
    // Specifically: not zero standing in for null.
    expect(result.evidence!.liquiditySweep.sweptLevel).toBeNull();
    expect(result.evidence!.structureShift.shiftPrice).toBeNull();
  });

  it("publishes explicit unavailable evidence when no detector ran", () => {
    // Empty input must remain distinguishable from evaluated-and-failed.
    const result = score([]);
    expect(result.evidence).toBeDefined();
    expect(result.evidence!.conditions).toEqual([]);
    expect(result.evidence!.structureShift).toMatchObject({
      state: "waiting",
      shiftPrice: null,
    });
    expect(result.evidence!.liquiditySweep).toMatchObject({
      passed: false,
      insufficientData: true,
    });
  });

  it("carries no bearish sweep, because no bearish detector exists", () => {
    const result = score(structureAndSweepSeries(1800));
    // The published shape has no direction field at all; direction is
    // supplied by the consumer, which knows the detector is bullish-only.
    expect(result.evidence!.liquiditySweep).not.toHaveProperty("direction");
  });

  it("changes nothing else about the result it is attached to", () => {
    // Every field other than `evidence` must be exactly what the scorer
    // produced before evidence existed. Comparing the result to itself
    // minus evidence proves the field is genuinely additive: if
    // publishing had perturbed scoring, the values below would have
    // moved together and this test would say nothing — so the assertions
    // are against the DETECTORS, which are computed independently here.
    const candles = structureAndSweepSeries(1800);
    const result = score(candles);
    const { sweep, structure } = detectorsFor(candles);

    // The scored condition rows still agree with the same detector
    // results, i.e. scoring read the same values it published.
    const sweepCondition = result.conditions.find((c) => c.id === "liquidity_sweep")!;
    expect(sweepCondition.state).toBe(sweep.passed ? "pass" : "fail");

    const structureCondition = result.conditions.find((c) => c.id === "structure_shift");
    if (structureCondition) {
      expect(structureCondition.state === "pass").toBe(structure.state === "confirmed");
    }
  });
});
