import { describe, expect, it, vi } from "vitest";
import {
  absentBarPolicy,
  axisBaselineObservations,
  baselineCacheIdentity,
  changedModeCacheKeys,
  classifyBaselineMode,
  classifyStickyBaselineMode,
  diffBaselineModeMaps,
  participationCanDriveNewInPlay,
  routeParticipationBaseline,
  type ParticipationRouteOps,
} from "@/lib/replay/baselineModes";

describe("axis-specific absent-bar semantics", () => {
  it("includes absent bars as zero participation observations only", () => {
    const sessions = [100, null, 50, null];
    expect(axisBaselineObservations(sessions, "participation")).toEqual([100, 0, 50, 0]);
    expect(axisBaselineObservations(sessions, "displacement")).toEqual([100, 50]);
    expect(axisBaselineObservations(sessions, "idiosyncrasy")).toEqual([100, 50]);
    expect(absentBarPolicy("participation")).toBe("zero_observation");
    expect(absentBarPolicy("displacement")).toBe("missing_observation");
  });

  it("classifies at the configured 60% boundary", () => {
    expect(classifyBaselineMode(0, 10)).toBe("dead");
    expect(classifyBaselineMode(5, 10)).toBe("sparse");
    expect(classifyBaselineMode(6, 10)).toBe("dense");
  });

  it("uses sticky hysteresis around the dense boundary", () => {
    expect(classifyStickyBaselineMode(59, 100, "dense")).toBe("dense");
    expect(classifyStickyBaselineMode(50, 100, "dense")).toBe("sparse");
    expect(classifyStickyBaselineMode(59, 100, "sparse")).toBe("sparse");
    expect(classifyStickyBaselineMode(60, 100, "sparse")).toBe("dense");
  });

  it("changes cache identity when a mode flip invalidates a bucket", () => {
    const changes = [{
      symbol: "AA",
      minuteEt: "09:29",
      subWindow: "premarket_final",
      oldMode: "sparse" as const,
      newMode: "dense" as const,
      oldPPresent: 0.59,
      newPPresent: 0.61,
      changeKind: "mode_flip" as const,
      modeChanged: true,
      cacheInvalidationRequired: true,
    }];
    expect(changedModeCacheKeys(changes, 4)).toEqual(["4:AA:09:29:sparse"]);
    expect(baselineCacheIdentity({ symbol: "AA", minuteEt: "09:29", mode: "dense" }, 5))
      .not.toBe(changedModeCacheKeys(changes, 4)[0]);
  });

  it("exercises a forced synthetic sparse-to-dense flip", () => {
    const common = { symbol: "SYNTH", minuteEt: "09:29", subWindow: "premarket_final", totalSessions: 100 };
    const changes = diffBaselineModeMaps(
      [{ ...common, sessionsWithBar: 59, pPresent: 0.59, mode: "sparse" }],
      [{ ...common, sessionsWithBar: 61, pPresent: 0.61, mode: "dense" }]
    );
    expect(changes).toEqual([expect.objectContaining({
      symbol: "SYNTH",
      oldMode: "sparse",
      newMode: "dense",
      changeKind: "mode_flip",
      modeChanged: true,
      cacheInvalidationRequired: true,
    })]);
    expect(changedModeCacheKeys(changes, 7)).toEqual(["7:SYNTH:09:29:sparse"]);
  });

  it("reports added buckets in a real regeneration-shaped diff", () => {
    const added = {
      symbol: "SPCX",
      minuteEt: "09:29",
      subWindow: "premarket_final",
      sessionsWithBar: 20,
      totalSessions: 250,
      pPresent: 0.08,
      mode: "sparse" as const,
    };
    expect(diffBaselineModeMaps([], [added])).toEqual([expect.objectContaining({
      symbol: "SPCX",
      oldMode: null,
      newMode: "sparse",
      changeKind: "added",
      cacheInvalidationRequired: false,
    })]);
  });
});

describe("mutually exclusive participation routing", () => {
  const dense = vi.fn(() => ({
    baselineMode: "dense" as const,
    signalKind: "median_mad_z" as const,
    value: 2,
    median: 10,
    mad: 2,
    unavailableReason: null, transform: "log1p" as const,
    firstObservedActivity: false,
    requiresDisplacementConfluence: false,
    dataQualityState: "observed_activity" as const,
  }));
  const sparse = vi.fn(() => ({
    baselineMode: "sparse" as const,
    signalKind: "presence_surprise_bits" as const,
    value: 0.5,
    pPresent: 0.25,
    surpriseBits: 2,
    firstObservedActivity: false,
    requiresDisplacementConfluence: false,
    dataQualityState: "observed_activity" as const,
  }));
  const ops: ParticipationRouteOps = { dense, sparse };

  it("a sparse bucket never routes through the MAD path", () => {
    dense.mockClear(); sparse.mockClear();
    const result = routeParticipationBaseline({ baselineMode: "sparse", historicalVolumeBySession: [null, null, 10, null], currentVolume: 12, currentPresent: true }, ops);
    expect(result.signalKind).toBe("presence_surprise_bits");
    expect(sparse).toHaveBeenCalledOnce();
    expect(dense).not.toHaveBeenCalled();
  });

  it("a dense bucket never routes through the presence path", () => {
    dense.mockClear(); sparse.mockClear();
    const result = routeParticipationBaseline({ baselineMode: "dense", historicalVolumeBySession: [10, 12, null, 14], currentVolume: 20, currentPresent: true }, ops);
    expect(result.signalKind).toBe("median_mad_z");
    expect(dense).toHaveBeenCalledOnce();
    expect(sparse).not.toHaveBeenCalled();
  });

  it("distinguishes a dead bucket with no bar as expected absence", () => {
    dense.mockClear(); sparse.mockClear();
    const result = routeParticipationBaseline({ baselineMode: "dead", historicalVolumeBySession: [null, null], currentVolume: 0, currentPresent: false }, ops);
    expect(result).toMatchObject({
      baselineMode: "dead",
      signalKind: "not_applicable",
      value: null,
      firstObservedActivity: false,
      dataQualityState: "dead_expected_absence",
    });
    expect(dense).not.toHaveBeenCalled();
    expect(sparse).not.toHaveBeenCalled();
  });

  it("saturates a dead bucket's first print and requires displacement confluence", () => {
    dense.mockClear(); sparse.mockClear();
    const result = routeParticipationBaseline({ baselineMode: "dead", historicalVolumeBySession: [null, null], currentVolume: 1, currentPresent: true }, ops);
    expect(result).toMatchObject({
      baselineMode: "dead",
      signalKind: "presence_surprise_bits",
      value: 1,
      surpriseBits: 6,
      firstObservedActivity: true,
      requiresDisplacementConfluence: true,
      dataQualityState: "dead_unexpected_activity",
    });
    expect(participationCanDriveNewInPlay(result, false)).toBe(false);
    expect(participationCanDriveNewInPlay(result, true)).toBe(true);
    expect(dense).not.toHaveBeenCalled();
    expect(sparse).not.toHaveBeenCalled();
  });

  it("reports sparse presence surprise in bits without calling it a z-score", () => {
    const result = routeParticipationBaseline({ baselineMode: "sparse", historicalVolumeBySession: Array.from({ length: 20 }, (_, index) => index === 0 ? 10 : null), currentVolume: 5, currentPresent: true });
    expect(result.signalKind).toBe("presence_surprise_bits");
    if (result.signalKind === "presence_surprise_bits") expect(result.surpriseBits).toBeCloseTo(4.3219, 3);
  });
});
