import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dispersion = JSON.parse(
  readFileSync(
    "data/replay/reports/attention-population-dispersion.json",
    "utf8",
  ),
);
const digest = readFileSync(
  "data/replay/reports/attention-session-digest.md",
  "utf8",
);

describe("population dispersion and trader digest artifacts", () => {
  it("retains the conservative mean fit after an explicit median replay comparison", () => {
    expect(dispersion.publishedFit).toBe("mean_session_population");
    expect(dispersion.comparison).toHaveLength(4);
    const sipTrain = dispersion.comparison.find(
      (row: any) => row.feedMode === "sip" && row.split === "train",
    );
    expect(sipTrain.meanTarget.inPlay.zeroSessions).toBe(3);
    expect(sipTrain.medianTarget.inPlay.zeroSessions).toBe(1);
    expect(sipTrain.medianTarget.inPlay.max).toBeGreaterThan(
      sipTrain.meanTarget.inPlay.max,
    );
  });

  it("reports train/holdout gaps inside session-to-session variance", () => {
    for (const row of dispersion.trainHoldoutGapAssessment) {
      expect(row.emerging.withinSessionVariance).toBe(true);
      expect(row.inPlay.withinSessionVariance).toBe(true);
    }
    expect(dispersion.fullPerSessionDistribution).toHaveLength(280);
    expect(dispersion.quietSessions).toEqual([
      "2026-02-13",
      "2026-04-20",
      "2026-05-06",
    ]);
  });

  it("publishes five required SIP session narratives without evaluation claims", () => {
    for (const date of [
      "2025-10-01",
      "2025-10-10",
      "2025-11-04",
      "2025-11-28",
      "2026-02-13",
    ]) {
      expect(digest).toContain(`## ${date}`);
    }
    for (const time of ["09:45", "10:15", "11:00", "13:00", "14:30"]) {
      expect(digest).toContain(`#### ${time} ET`);
    }
    expect(digest).toContain("Reached IN PLAY");
    expect(digest).toContain("Reached EMERGING but never IN PLAY");
    expect(digest).toContain("Quiet stretches — no names IN PLAY");
    expect(digest).toContain("Cluster compaction and override changes");
    expect(digest).toContain(
      "This is a description of what the replay engine did.",
    );
    expect(digest).toContain("OPTIMISTICALLY BIASED");
  });
});
