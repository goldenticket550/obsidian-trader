import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const diagnosis = JSON.parse(
  readFileSync("data/replay/reports/waking-up-diagnosis.json", "utf8"),
);
const proposal = JSON.parse(
  readFileSync("data/replay/reports/waking-up-proposal.json", "utf8"),
);
const report = readFileSync(
  "data/replay/reports/waking-up-diagnosis.md",
  "utf8",
);
const digest = readFileSync(
  "data/replay/reports/attention-session-digest-waking-proposal.md",
  "utf8",
);

describe("WAKING UP zero-coverage diagnosis", () => {
  it("publishes velocity units and empirical tails for all seven viable sets", () => {
    expect(diagnosis.velocityRows).toHaveLength(7);
    const regular = diagnosis.velocityRows.find(
      (row: any) => row.feedMode === "sip" && row.subWindow === "regular",
    );
    expect(regular.publishedVelocityThreshold).toBe(7.62);
    expect(regular.units.scoreVelocityPerMinute).toContain("scoreDelta3m / 3");
    expect(regular.scoreDelta1m.p99).toBeGreaterThan(30);
    expect(regular.scoreDelta3m.p99).toBeGreaterThan(39);
    expect(regular.scoreDelta5m.p99).toBeGreaterThan(43);
    expect(regular.rollingZDelta5m.p99).toBeGreaterThan(3.2);
    expect(regular.fractionVelocityAtLeast2).toBeCloseTo(0.2643457723);
    expect(regular.fractionVelocityAtLeastPublished).toBeCloseTo(0.0512261288);
  });

  it("identifies freshness as the fatal first gate with an explicit zero funnel", () => {
    for (const row of diagnosis.gateRows) {
      expect(row.independent.freshness).toEqual({ count: 0, fraction: 0 });
      for (const gate of [
        "freshness",
        "atrTravel",
        "minimumScore",
        "dataQuality",
        "persistence",
        "velocity",
      ]) {
        expect(row.cumulative[gate]).toEqual({ count: 0, fraction: 0 });
      }
      expect(row.actualWakingRows).toBe(0);
    }
    expect(
      diagnosis.freshnessInputCensus.find(
        (row: any) => row.feedMode === "sip",
      ).fractionPullbackObserved,
    ).toBe(1);
  });

  it("proves the 30-minute exit did not create the impossible freshness gate", () => {
    expect(diagnosis.freshnessVariants).toHaveLength(3);
    for (const row of diagnosis.freshnessVariants) {
      expect(row.counts.Fresh).toBe(0);
      expect(row.counts.Developing).toBe(0);
      expect(row.wakingRows).toBe(0);
    }
    expect(
      diagnosis.freshnessVariants.find(
        (row: any) => row.id === "accepted_exit_persistence_30",
      ).activeEpisodeMinutes,
    ).toBe(68_395);
  });

  it("records but does not combine the backdating ATR-reference defect", () => {
    expect(diagnosis.backdating).toMatchObject({
      otherwiseQualifyingMoments: 4324,
      blockedByActualAtrButNotQualificationAtr: 360,
      eligibilityChangedByBackdating: 0,
    });
  });

  it("keeps the single-gate pullback correction counterfactual and visible in the digest", () => {
    expect(proposal.scope).toBe("single_gate_counterfactual_not_published");
    expect(proposal.totalWakingRows).toBe(6);
    expect(proposal.rows.flatMap((row: any) => row.events)).toHaveLength(6);
    expect(digest).toContain("Counterfactual WAKING UP rows");
    expect(digest).toContain("| 2026-02-13 | 10:34 | AMAT |");
  });

  it("quantifies that displayed IN PLAY is dominated by pending exits", () => {
    const displayed = diagnosis.exitPersistenceCost.displayed;
    expect(displayed.total).toBe(8411);
    expect(displayed.fractionPendingExit).toBeGreaterThan(0.8);
    expect(displayed.scoreDecayFromEpisodePeak.p50).toBeGreaterThan(56);
    expect(report).toContain("too generous");
  });

  it("retains the replay disclosure and refuses ground-truth conclusions", () => {
    expect(diagnosis.groundTruthValidation).toBe("REFUSED");
    expect(diagnosis.disclosure).toContain("OPTIMISTICALLY BIASED");
    expect(report).toContain("No gate or active calibration was changed");
  });
});