import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sweep = JSON.parse(readFileSync("data/replay/reports/inplay-enter-freshness-sweep.json", "utf8"));
const thresholds = JSON.parse(readFileSync("data/replay/reports/attention-thresholds.json", "utf8"));
const report = readFileSync("data/replay/reports/inplay-enter-freshness-sweep.md", "utf8");

describe("IN PLAY entry freshness diagnostic", () => {
  it("keeps the published threshold immutable and reports every requested level", () => {
    expect(sweep.status).toBe("DIAGNOSTIC_ONLY_NOT_PUBLISHED");
    expect(sweep.results.map((row: any) => row.threshold)).toEqual([0.8, 0.7, 0.6, 0.5, 0.4]);
    expect(sweep.recommendation).toMatchObject({ threshold: null, status: "NO_ACCEPTABLE_LOWER_THRESHOLD", published: false, currentThresholdUnchanged: 0.8 });
    expect(thresholds.sets.sip.regular.values).toMatchObject({ inPlayEnterCore: 0.8, inPlayExitCore: 0.66 });
  });

  it("refuses invalid hysteresis points and enforces quiet-session rejection corpus-wide", () => {
    const current = sweep.results.find((row: any) => row.threshold === 0.8);
    const lower = sweep.results.find((row: any) => row.threshold === 0.7);
    expect(current.allRequiredQuiet).toBe(true);
    expect(lower.allRequiredQuiet).toBe(false);
    expect(lower.corpusQuiet).toMatchObject({ "2026-02-13": true, "2026-04-20": false, "2026-05-06": false });
    for (const threshold of [0.6, 0.5, 0.4]) {
      const row = sweep.results.find((candidate: any) => candidate.threshold === threshold);
      for (const split of row.splits) expect(split.configurationValidity).toBe("diagnostic_only_enter_not_above_fixed_exit");
    }
  });

  it("publishes the measured freshness and conversion failure without ground-truth claims", () => {
    const row = sweep.results.find((candidate: any) => candidate.threshold === 0.7);
    const train = row.splits.find((split: any) => split.split === "train");
    const holdout = row.splits.find((split: any) => split.split === "holdout");
    expect(train.freshness.shares.Extended).toBeGreaterThan(0.95);
    expect(holdout.freshness.shares.Extended).toBeGreaterThan(0.96);
    expect(train.conversion.rate).toBeCloseTo(0.6816608997);
    expect(holdout.conversion.rate).toBeCloseTo(0.6);
    expect(train.conversion.leadMinutes.median).toBe(0);
    expect(holdout.conversion.leadMinutes.median).toBe(0);
    expect(sweep.groundTruthValidation).toBe("REFUSED");
    expect(sweep.disclosure).toContain("OPTIMISTICALLY BIASED");
    expect(report).toContain("No lower threshold is recommendable");
  });
});