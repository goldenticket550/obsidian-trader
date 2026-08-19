import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync("data/replay/calibration/session-manifest.json", "utf8"),
);
const report = JSON.parse(
  readFileSync(
    "data/replay/reports/attention-population-calibration.json",
    "utf8",
  ),
);
const availability = JSON.parse(
  readFileSync("data/replay/reports/iex-reference-availability.json", "utf8"),
);
const published = JSON.parse(
  readFileSync("data/replay/reports/attention-thresholds.json", "utf8"),
);

describe("population calibration artifacts", () => {
  it("freezes a reproducible 28/12 regime-diverse split before fitting", () => {
    expect(manifest.sessions).toHaveLength(40);
    expect(
      manifest.sessions.filter((row: any) => row.split === "train"),
    ).toHaveLength(28);
    expect(
      manifest.sessions.filter((row: any) => row.split === "holdout"),
    ).toHaveLength(12);
    expect(manifest.sessions.some((row: any) => row.earlyClose)).toBe(true);
    for (const regime of [
      "trending_up",
      "trending_down",
      "chopping",
      "quiet",
      "high_volatility",
    ]) {
      expect(
        manifest.sessions.some((row: any) => row.tags.includes(regime)),
      ).toBe(true);
    }
  });

  it("publishes seven distinct calibrated sets and five terminal IEX unavailable sets", () => {
    const sets = [
      ...Object.values(published.sets.sip),
      ...Object.values(published.sets.iex_partial),
    ] as any[];
    expect(
      sets.filter((set) => set.calibrationStatus === "calibrated"),
    ).toHaveLength(7);
    expect(
      sets.filter(
        (set) => set.calibrationStatus === "unavailable_by_construction",
      ),
    ).toHaveLength(5);
    expect(
      sets.filter((set) => set.calibrationStatus === "pending_calibration"),
    ).toHaveLength(0);
    expect(
      new Set(
        sets
          .filter((set) => set.calibrationStatus === "calibrated")
          .map((set) =>
            JSON.stringify({
              normalization: set.normalization,
              values: set.values,
            }),
          ),
      ).size,
    ).toBe(7);
    for (const set of sets.filter(
      (row) => row.calibrationStatus === "unavailable_by_construction",
    )) {
      expect(Object.values(set.values).every((value) => value === null)).toBe(
        true,
      );
      expect(set.unavailableReason).toBe("insufficient_reference");
    }
  });

  it("replays deterministically, meets SIP regular usability bands, and preserves quiet sessions", () => {
    expect(report.determinism).toMatchObject({
      identical: true,
      firstHash: report.determinism.secondHash,
    });
    expect(report.populations).toHaveLength(280);
    expect(report.inPlayCountDistribution.evaluatedMinutes).toBe(15_420);
    const coveredMinutes =
      report.inPlayCountDistribution.evaluatedMinutes -
      report.inPlayCountDistribution.histogram["0"];
    const coverage =
      coveredMinutes / report.inPlayCountDistribution.evaluatedMinutes;
    expect(coverage).toBeGreaterThanOrEqual(0.2);
    expect(coverage).toBeLessThanOrEqual(0.4);
    expect(
      report.populations.some(
        (row: any) =>
          row.feedMode === "sip" &&
          row.subWindow === "regular" &&
          row.zeroInPlayMinutes === row.evaluatedMinutes,
      ),
    ).toBe(true);
    expect(report.holdoutDivergence.some((row: any) => row.material)).toBe(
      false,
    );
    expect(report.groundTruthValidation).toBe("REFUSED");
  });

  it("reports structural IEX sparsity without fallback", () => {
    const byWindow = new Map<string, any>(
      availability.windows.map((row: any) => [row.subWindow, row]),
    );
    expect(byWindow.get("regular").scoreable).toBeGreaterThan(500_000);
    expect(byWindow.get("premarket_early").scoreable).toBe(0);
    expect(byWindow.get("premarket_core").scoreable).toBe(79);
    expect(byWindow.get("premarket_final").scoreable).toBe(118);
    expect(byWindow.get("after_hours_core").scoreable).toBe(39);
    expect(byWindow.get("after_hours_late").scoreable).toBe(0);
  });
});
