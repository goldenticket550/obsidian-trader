import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const resolution = JSON.parse(
  readFileSync(
    "data/replay/reports/attention-usability-resolution.json",
    "utf8",
  ),
);
const thresholds = JSON.parse(
  readFileSync("data/replay/reports/attention-thresholds.json", "utf8"),
);
const report = readFileSync(
  "data/replay/reports/attention-usability-resolution.md",
  "utf8",
);

describe("accepted attention usability calibration", () => {
  it("replaces final clipping with the declared asymmetric discount scale", () => {
    expect(resolution.acceptedScorePath.final).toBe(
      "100 * core * modifier / (1 + idiosyncrasyInfluence), no clipping",
    );
    expect(resolution.acceptedScorePath.appliedModifierScale).toEqual([
      0.7391304347826088,
      1,
    ]);
    expect(resolution.acceptedScorePath.unselectedInfluence075Scale).toEqual([
      0.8604651162790699,
      1,
    ]);
  });

  it("publishes an ordered slow-exit policy and passes the usability targets", () => {
    expect(resolution.selectedPolicy).toMatchObject({
      id: "enter-0.80-exit-0.70-p30",
      inPlayEnterCore: 0.8,
      inPlayExitCore: 0.7,
      exitPersistenceMinutes: 30,
    });
    expect(resolution.final.fractionMinutesWithInPlay).toBeGreaterThanOrEqual(
      0.2,
    );
    expect(resolution.final.fractionMinutesWithInPlay).toBeLessThanOrEqual(0.4);
    expect(resolution.final.inPlayOccupancyMinutes.median).toBeGreaterThanOrEqual(
      10,
    );
    for (const date of resolution.acceptance.threeQuietSessionsRequired) {
      expect(resolution.final.quietSessions).toContain(date);
    }
    expect(resolution.acceptance).toMatchObject({
      coveragePassed: true,
      dwellPassed: true,
      quietDaysPassed: true,
      scoreSaturationPassed: true,
    });
  });

  it("demonstrates within-minute ordering spread while retaining WAKING UP as a finding", () => {
    expect(resolution.final.scoreSpread.multiNameMinutes).toBeGreaterThan(900);
    expect(resolution.final.scoreSpread.withinMinuteIqr.median).toBeGreaterThan(9);
    expect(
      resolution.final.scoreSpread.distinctExact.median,
    ).toBeGreaterThanOrEqual(3);
    expect(resolution.final.scoreSpread.fullyTiedExactMinutes).toBe(0);
    expect(resolution.episodePeaks.after.exact100).toBe(0);
    expect(resolution.final.minutesWithWakingUp).toBe(0);
    expect(report).toContain("failed-usability finding");
  });

  it("publishes the state policy in the versioned SIP regular calibration set", () => {
    const regular = thresholds.sets.sip.regular;
    expect(regular.measurementTransforms).toMatchObject({
      participationDense: "log1p",
      displacementRange: "log1p",
    });
    expect(regular.values).toMatchObject({
      inPlayEnterCore: 0.8,
      inPlayExitCore: 0.66,
      enterPersistenceMinutes: 2,
      exitPersistenceMinutes: 15,
    });
    expect(regular.values.watchingExitCore).toBeLessThanOrEqual(
      regular.values.emergingExitCore,
    );
    expect(regular.values.emergingExitCore).toBeLessThanOrEqual(
      regular.values.inPlayExitCore,
    );
  });

  it("replays deterministically and refuses ground-truth conclusions", () => {
    expect(resolution.determinism).toMatchObject({
      identical: true,
      firstHash: resolution.determinism.secondHash,
    });
    expect(resolution.groundTruthValidation).toBe("REFUSED");
    expect(resolution.disclosure).toContain("OPTIMISTICALLY BIASED");
  });
});