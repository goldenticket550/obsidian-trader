import { describe, expect, it } from "vitest";
import { makeCandle } from "@/lib/fixtures/candles";
import { buildContinuousSameTimeBaseline } from "@/lib/attention/baselines";
import {
  computeDisplacementAxis,
  computeIdiosyncrasyAxis,
  computeParticipationAxis,
} from "@/lib/attention/attentionAxes";
import { scoreAttention } from "@/lib/attention/attentionScore";
import { routeParticipationBaseline } from "@/lib/replay/baselineModes";
import { calibrationSetForScore, createPendingFeedAwareThresholdStore } from "@/lib/replay/feedAwareAttentionThresholds";

describe("A2 identical-bar feed-mode regression", () => {
  it("routes one immutable bar observation through both internally consistent cores", () => {
    const stock = makeCandle({ time: 1, open: 100, high: 103, low: 99.5, close: 102, volume: 20 });
    const benchmark = makeCandle({ time: 1, open: 100, high: 101.2, low: 99.8, close: 101, volume: 100 });
    const sector = makeCandle({ time: 1, open: 100, high: 102.2, low: 99.9, close: 101.8, volume: 80 });
    const historicalVolume = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const participationSignal = routeParticipationBaseline({
      baselineMode: "dense", historicalVolumeBySession: historicalVolume,
      currentVolume: stock.volume, currentPresent: true,
    });
    const dollarVolumeBaseline = buildContinuousSameTimeBaseline({
      axis: "participation",
      historicalValues: historicalVolume.map((volume) => volume * stock.close),
      currentValue: stock.volume * stock.close,
      transform: "log1p",
      dataQualityState: "ok",
    });
    const participation = computeParticipationAxis({
      signal: participationSignal, currentVolume: stock.volume, currentPrice: stock.close, dollarVolumeBaseline,
    });
    const displacement = computeDisplacementAxis({
      bars: [stock], atr: 2,
      historicalRangeAtr: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1],
      historicalPathEfficiency: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
      dataQualityState: "ok",
    });
    const idiosyncrasy = computeIdiosyncrasyAxis({
      stockBar: stock, benchmarkBar: benchmark, sectorBar: sector,
      historicalStockVsBenchmark: [0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009, 0.01],
      historicalSectorVsBenchmark: [0.0001, 0.0002, 0.0003, 0.0004, 0.0005, 0.0006, 0.0007, 0.0008, 0.0009, 0.001],
      dataQualityState: "ok",
    });

    const common = { subWindow: "regular" as const, participation, displacement, idiosyncrasy };
    const calibrationStore = createPendingFeedAwareThresholdStore(3);
    const sip = scoreAttention({ feedMode: "sip", calibrationSet: calibrationSetForScore(calibrationStore, "regular", "sip"), ...common });
    const iex = scoreAttention({ feedMode: "iex_partial", calibrationSet: calibrationSetForScore(calibrationStore, "regular", "iex_partial"), ...common });
    expect(sip.attention).not.toBe(iex.attention);
    expect(sip.explanation.coreAxes).toEqual(["participation", "displacement"]);
    expect(iex.explanation.coreAxes).toEqual(["displacement", "idiosyncrasy"]);
    expect(iex).toMatchObject({ participationDisplayOnly: true, participationScoringWeight: 0, volumeAccelerationEnabled: false });
  });
});
