import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const diagnosis = JSON.parse(
  readFileSync(
    "data/replay/reports/attention-saturation-experiments.json",
    "utf8",
  ),
);
const candidates = JSON.parse(
  readFileSync(
    "data/replay/reports/attention-saturation-candidate-replay.json",
    "utf8",
  ),
);
const population = JSON.parse(
  readFileSync(
    "data/replay/reports/attention-population-calibration.json",
    "utf8",
  ),
);
const resolution = JSON.parse(
  readFileSync(
    "data/replay/reports/attention-usability-resolution.json",
    "utf8",
  ),
);
const beforeDigest = readFileSync(
  "data/replay/reports/attention-session-digest-before-usability.md",
  "utf8",
);
const afterDigest = readFileSync(
  "data/replay/reports/attention-session-digest-after-usability.md",
  "utf8",
);

describe("attention saturation evidence", () => {
  it("retains unclamped evidence that participation, not displacement, owns the severe regular-session tail", () => {
    const sipDense = diagnosis.rawRows.find(
      (row: any) =>
        row.feedMode === "sip" &&
        row.subWindow === "regular" &&
        row.baselineMode === "dense",
    );
    expect(sipDense.participationRaw.p99).toBeGreaterThan(12);
    expect(sipDense.participationRaw.max).toBeGreaterThan(400);
    expect(sipDense.participationRaw.wouldHitCap).toBeGreaterThan(0.02);
    expect(sipDense.participationLog.wouldHitCap).toBeLessThan(0.003);
    expect(sipDense.displacementRaw.p99).toBeLessThan(4);
    expect(sipDense.displacementRaw.wouldHitCap).toBeLessThan(0.001);
  });

  it("retains the diagnostic comparison and publishes the accepted combined rescale separately", () => {
    const byCandidate = new Map(
      candidates.results.map((row: any) => [row.candidate, row]),
    );
    for (const candidate of [
      "log_participation",
      "empirical_curves",
      "log_participation_range_empirical_curves",
    ]) {
      expect(
        (byCandidate.get(candidate) as any)
          .acceptancePeakHundredAtMostTenPercent,
      ).toBe(false);
    }
    const proposed = byCandidate.get(
      "log_participation_range_theoretical_max_rescale",
    ) as any;
    expect(proposed.exactHundred).toBe(0);
    expect(proposed.peakAttention.min).toBeGreaterThan(70);
    expect(proposed.peakAttention.max).toBeLessThan(99);
    expect(proposed.uniquePeaksAtOneDecimal).toBeGreaterThan(60);
    expect(candidates.scope).toBe("candidate_replay_only_not_published");
    expect(resolution.status).toBe("POPULATION_USABILITY_CALIBRATED");
    expect(resolution.acceptedScorePath).toMatchObject({
      participation: "log1p volume + log1p dollar volume",
      displacement: "log1p range; linear path efficiency",
      idiosyncrasyInfluence: 0.15,
    });
    expect(resolution.acceptedScorePath.final).toContain("no clipping");
    expect(resolution.episodePeaks.after.fractionExact100).toBeLessThanOrEqual(
      0.1,
    );
  });

  it("publishes the recalibrated regular-session histogram without suppressing broad-tape minutes", () => {
    const distribution = population.inPlayCountDistribution;
    expect(distribution.evaluatedMinutes).toBe(15_420);
    expect(distribution.histogram["0"]).toBe(12_084);
    expect(distribution.peakSimultaneousInPlay).toBe(28);
    expect(distribution.broadTapeMinutes).toBe(0);
  });

  it("keeps the corrected GDX duration semantics in the comparable before/after digests", () => {
    expect(beforeDigest).toContain("| GDX | 10:47 ET | 100.0 | 1 | 6 min | 2 min |");
    expect(beforeDigest).not.toContain("| GDX | 10:47 ET | 100.0 | 1 | 553 min |");
    expect(afterDigest).toContain("| GDX | 10:47 ET | 92.4 | 1 | 34 min | 30 min |");
    expect(afterDigest).toContain("Episode lifetime");
    expect(afterDigest).toContain("IN PLAY occupancy");
  });
});