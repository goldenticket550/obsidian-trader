import { describe, expect, it } from "vitest";
import { evaluateAttentionDataQuality, splitEstablishedAndLimitedHistory } from "@/lib/attention/dataQuality";

const ready = {
  tradingDate: "2026-08-14",
  sessionPhase: "regular" as const,
  baselineSampleSize: 20,
  minBaselineSessions: 10,
  availableBars: 5,
  minimumBars: 3,
};

describe("Attention Engine data quality", () => {
  it("marks a newly listed symbol limited_history, not ok or insufficient_baseline", () => {
    const result = evaluateAttentionDataQuality({ ...ready, listedSince: "2026-06-15", minHistorySessions: 120 });
    expect(result.state).toBe("limited_history");
    expect(result.rankEligible).toBe(true);
    expect(result.thresholdCalibrationEligible).toBe(false);
    expect(result.sessionsSinceListing).toBeGreaterThan(0);
    expect(result.sessionsSinceListing).toBeLessThan(120);
  });

  it("keeps insufficient baseline separate from limited listing history", () => {
    expect(evaluateAttentionDataQuality({ ...ready, baselineSampleSize: 9, listedSince: "2026-06-15" }).state).toBe("insufficient_baseline");
  });

  it("allows established names into calibration", () => {
    expect(evaluateAttentionDataQuality(ready)).toMatchObject({ state: "ok", rankEligible: true, thresholdCalibrationEligible: true });
  });

  it("splits replay statistics into cohorts that cannot be pooled", () => {
    const rows = [{ symbol: "AAPL", dataQualityState: "ok" as const }, { symbol: "SPCX", dataQualityState: "limited_history" as const }];
    expect(splitEstablishedAndLimitedHistory(rows)).toEqual({ established: [rows[0]], limitedHistory: [rows[1]] });
  });
});
