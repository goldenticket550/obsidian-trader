import { describe, expect, it } from "vitest";
import { buildContinuousSameTimeBaseline, buildParticipationSameTimeBaseline, collectSameTimeBucket } from "@/lib/attention/baselines";
import { makeCandle } from "@/lib/fixtures/candles";

describe("A1 same-time-of-day baselines", () => {
  it("retains absent sessions so participation can observe zero", () => {
    const candle = makeCandle({ time: Date.parse("2026-08-13T13:29:00Z") / 1000, volume: 10 });
    expect(collectSameTimeBucket([candle], ["2026-08-13", "2026-08-14"], 9 * 60 + 29, 1, (bars) => bars.reduce((sum, bar) => sum + bar.volume, 0))).toEqual([
      { tradingDate: "2026-08-13", value: 10 },
      { tradingDate: "2026-08-14", value: null },
    ]);
  });

  it("includes participation absences as zero but excludes displacement absences", () => {
    const history = [10, 12, 14, 16, 18, 20, null, null, null, null];
    expect(buildContinuousSameTimeBaseline({ axis: "participation", historicalValues: history, currentValue: 30, dataQualityState: "ok" }).sampleSize).toBe(10);
    expect(buildContinuousSameTimeBaseline({ axis: "displacement", historicalValues: history, currentValue: 30, minSessions: 6, dataQualityState: "ok" }).sampleSize).toBe(6);
  });

  it("winsorizes the historical tail and clamps z without fabricating a MAD", () => {
    const result = buildContinuousSameTimeBaseline({ axis: "displacement", historicalValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10_000], currentValue: 100, dataQualityState: "ok" });
    expect(result.state).toBe("ok");
    expect(result.winsorCap).toBeLessThan(10_000);
    expect(result.value).toBe(8);
  });

  it("computes limited-history baselines for ranking but excludes them from calibration", () => {
    const result = buildParticipationSameTimeBaseline({ baselineMode: "dense", historicalValues: [10, 11, 12, 13, 14, 15, null, null, null, null], currentValue: 20, currentPresent: true, dataQualityState: "limited_history" });
    expect(result.baselineMode).toBe("dense");
    expect(result.symbolDataQualityState).toBe("limited_history");
    expect(result.calibrationEligible).toBe(false);
  });

  it("keeps sparse participation on the presence path", () => {
    const result = buildParticipationSameTimeBaseline({ baselineMode: "sparse", historicalValues: [10, null, null, null, null], currentValue: 1, currentPresent: true, dataQualityState: "ok" });
    expect(result.signalKind).toBe("presence_surprise_bits");
  });
  it("computes log1p baselines on the transformed scale and reports the transform", () => {
    const history = [100, 120, 140, 160, 180, 200, 220, 240, 260, 280];
    const linear = buildContinuousSameTimeBaseline({ axis: "participation", historicalValues: history, currentValue: 1_000, transform: "linear", dataQualityState: "ok" });
    const logged = buildContinuousSameTimeBaseline({ axis: "participation", historicalValues: history, currentValue: 1_000, transform: "log1p", dataQualityState: "ok" });
    expect(logged.transform).toBe("log1p");
    expect(logged.median).toBeCloseTo(Math.log1p(190), 2);
    expect(logged.value).not.toBe(linear.value);
  });
});
