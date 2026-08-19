import { describe, expect, it } from "vitest";
import { makeCandle } from "@/lib/fixtures/candles";
import {
  calculatePathEfficiency,
  computeDisplacementAxis,
  computeIdiosyncrasyAxis,
  computeParticipationAxis,
} from "@/lib/attention/attentionAxes";
import { routeParticipationBaseline } from "@/lib/replay/baselineModes";

const histories = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];

describe("A2 axes", () => {
  it("keeps sparse participation on presence surprise with no MAD representation", () => {
    const signal = routeParticipationBaseline({
      baselineMode: "sparse", historicalVolumeBySession: [1, null, null, null, null],
      currentVolume: 10, currentPresent: true,
    });
    const axis = computeParticipationAxis({ signal, currentVolume: 10, currentPrice: 20 });
    expect(axis.normalizationInputKind).toBe("surprise_bits");
    expect(axis.components[0]).toMatchObject({ pPresent: 0.2, signalKind: "presence_surprise_bits", baselineMad: null });
  });

  it("saturates first activity in a dead bucket and preserves its confluence flag", () => {
    const signal = routeParticipationBaseline({ baselineMode: "dead", historicalVolumeBySession: [null, null], currentVolume: 1, currentPresent: true });
    const axis = computeParticipationAxis({ signal, currentVolume: 1, currentPrice: 100 });
    expect(axis).toMatchObject({ value: 6, firstObservedActivity: true, requiresDisplacementConfluence: true, baselineMode: "dead" });
  });

  it("returns null path efficiency below minPathAtr instead of fabricating 1.0", () => {
    const bars = [makeCandle({ time: 1, open: 100, close: 100.01, high: 100.02, low: 99.99 })];
    expect(calculatePathEfficiency(bars, 10, 0.1)).toMatchObject({ value: null, minimumPath: 1 });
  });

  it("treats an absent displacement bar as missing", () => {
    const axis = computeDisplacementAxis({ bars: [], atr: 1, historicalRangeAtr: histories, historicalPathEfficiency: histories, dataQualityState: "ok" });
    expect(axis).toMatchObject({ status: "unavailable", normalized: null, unavailableReason: "absent_price_bar" });
  });

  it("reports stock-vs-benchmark and sector-vs-benchmark separately", () => {
    const stock = makeCandle({ time: 1, open: 100, close: 104 });
    const benchmark = makeCandle({ time: 1, open: 100, close: 101 });
    const sector = makeCandle({ time: 1, open: 100, close: 103 });
    const result = computeIdiosyncrasyAxis({
      stockBar: stock, benchmarkBar: benchmark, sectorBar: sector,
      historicalStockVsBenchmark: histories.map((value) => value / 100),
      historicalSectorVsBenchmark: histories.map((value) => value / 100),
      dataQualityState: "ok",
    });
    expect(result.stockVsBenchmark).toBeCloseTo(0.03);
    expect(result.sectorVsBenchmark).toBeCloseTo(0.02);
    expect(result.components.map((component) => component.name)).toEqual(["stock_vs_benchmark", "sector_vs_benchmark"]);
  });
});
