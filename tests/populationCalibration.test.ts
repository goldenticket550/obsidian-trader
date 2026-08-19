import { describe, expect, it } from "vitest";
import {
  assertCalibrationConfluence,
  deriveCalibrationCurve,
  derivePopulationThresholds,
  inverseNormalizedValue,
  partnerInputRequired,
  scoreRawCalibrationPoint,
} from "@/lib/replay/populationCalibration";
import { PROVISIONAL_ATTENTION_NORMALIZATION_CURVES } from "@/lib/attention/attentionAxes";

describe("population calibration arithmetic", () => {
  it("translates the provisional curve thresholds into interpretable z values", () => {
    const curve = { z50: 2, k: 1.2 };
    expect(inverseNormalizedValue(0.25, curve)).toBeCloseTo(1.0845, 4);
    expect(inverseNormalizedValue(0.5, curve)).toBeCloseTo(2, 10);
    expect(inverseNormalizedValue(0.7, curve)).toBeCloseTo(2.7061, 4);
    expect(partnerInputRequired(0.7, 6, curve, curve)).toBeCloseTo(1.9801, 4);
  });

  it("hard-fails a population fit that loses two-axis confluence", () => {
    expect(() =>
      assertCalibrationConfluence({
        feedMode: "sip",
        curves: PROVISIONAL_ATTENTION_NORMALIZATION_CURVES,
        thresholds: {
          watchingEnterCore: 0.2,
          watchingExitCore: 0.15,
          emergingEnterCore: 0.3,
          emergingExitCore: 0.25,
          inPlayEnterCore: 0.4,
          inPlayExitCore: 0.35,
          newInPlayVelocityPerMinute: 1,
          enterPersistenceMinutes: 2,
          exitPersistenceMinutes: 2,
        },
      }),
    ).toThrow(/Confluence calibration failed/);
  });

  it("derives finite data-shaped curves and keeps Path A and Path B distinct", () => {
    const curve = deriveCalibrationCurve(
      Array.from({ length: 100 }, (_, index) => index / 25),
      "z",
      { z50: 2, k: 1.2 },
    );
    expect(curve.z50).toBeGreaterThan(1.5);
    expect(curve.k).toBeGreaterThan(0);
    const point = {
      tradingDate: "2026-01-02",
      symbol: "NVDA",
      minuteOfDay: 600,
      subWindow: "regular" as const,
      participationInput: 3,
      participationInputKind: "z" as const,
      displacementZ: 2,
      idiosyncrasyZ: 1,
      limitedHistory: false,
    };
    const sip = scoreRawCalibrationPoint(
      { ...point, feedMode: "sip" },
      PROVISIONAL_ATTENTION_NORMALIZATION_CURVES,
    );
    const iex = scoreRawCalibrationPoint(
      { ...point, feedMode: "iex_partial" },
      PROVISIONAL_ATTENTION_NORMALIZATION_CURVES,
    );
    expect(sip.core).not.toBe(iex.core);
  });

  it("fits state thresholds to two consecutive minutes rather than one-minute spikes", () => {
    const points = [
      { tradingDate: "2026-01-02", symbol: "A", minuteOfDay: 600, core: 0.9 },
      { tradingDate: "2026-01-02", symbol: "A", minuteOfDay: 601, core: 0.2 },
      { tradingDate: "2026-01-02", symbol: "B", minuteOfDay: 600, core: 0.7 },
      { tradingDate: "2026-01-02", symbol: "B", minuteOfDay: 601, core: 0.7 },
    ].map((point) => ({
      ...point,
      feedMode: "sip" as const,
      subWindow: "regular" as const,
      participationInput: 1,
      participationInputKind: "z" as const,
      displacementZ: 1,
      idiosyncrasyZ: 1,
      attention: point.core * 100,
      limitedHistory: false,
    }));
    const thresholds = derivePopulationThresholds(points, {
      watching: 1,
      emerging: 1,
      inPlay: 1,
    });
    expect(thresholds.watchingEnterCore).toBe(0.7);
  });

  it("keeps mean and median session-population targets explicit and distinct", () => {
    const cores = [
      ["2026-01-02", [0.9, 0.8, 0.7, 0.6]],
      ["2026-01-03", [0.5, 0.4, 0.3, 0.2]],
      ["2026-01-04", [0.19, 0.18, 0.17, 0.16]],
    ] as const;
    const points = cores.flatMap(([tradingDate, values]) =>
      values.flatMap((core, symbolIndex) =>
        [600, 601].map((minuteOfDay) => ({
          tradingDate,
          symbol: String.fromCharCode(65 + symbolIndex),
          minuteOfDay,
          core,
          feedMode: "sip" as const,
          subWindow: "regular" as const,
          participationInput: 1,
          participationInputKind: "z" as const,
          displacementZ: 1,
          idiosyncrasyZ: 1,
          attention: core * 100,
          limitedHistory: false,
        })),
      ),
    );
    const targets = { watching: 1, emerging: 1, inPlay: 1 };
    expect(
      derivePopulationThresholds(points, targets, "mean").watchingEnterCore,
    ).toBe(0.7);
    expect(
      derivePopulationThresholds(points, targets, "median").watchingEnterCore,
    ).toBe(0.5);
  });
});
