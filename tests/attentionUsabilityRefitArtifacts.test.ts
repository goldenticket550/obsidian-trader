import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const waking = JSON.parse(readFileSync("data/replay/reports/waking-up-usability-calibration.json", "utf8"));
const exit = JSON.parse(readFileSync("data/replay/reports/in-play-liveness-frontier.json", "utf8"));
const thresholds = JSON.parse(readFileSync("data/replay/reports/attention-thresholds.json", "utf8"));
const wakingDigest = readFileSync("data/replay/reports/attention-session-digest-after-waking-fit.md", "utf8");
const exitDigest = readFileSync("data/replay/reports/attention-session-digest-after-exit-fit.md", "utf8");
const spec = readFileSync("docs/attention-engine-spec.md", "utf8");

describe("published pullback fix and usability refits", () => {
  it("publishes episode-scoped 0.5/0.3 ATR pullback semantics", () => {
    expect(waking.publishedPullback).toEqual({
      scope: "episode",
      directionalExcursionAtr: 0.5,
      retracementAtr: 0.3,
    });
    expect(spec).toContain("a 06:00 session pullback cannot prevent a new");
  });

  it("refuses to publish the WAKING candidate because coverage and dwell fail", () => {
    expect(waking.status).toBe("NO_ACCEPTABLE_WAKING_UP_FIT");
    expect(waking.publishedWakingConfig).toBeNull();
    expect(waking.acceptance).toMatchObject({
      trainingCoveragePassed: false,
      trainingDwellPassed: false,
      quietSessionsPassed: true,
    });
    expect(waking.current.splits[0].fractionMinutesWithWakingUp).toBeCloseTo(1063 / 10740);
    expect(waking.current.splits[1].fractionMinutesWithWakingUp).toBeCloseTo(535 / 4680);
  });

  it("keeps honest back-dated ATR travel and reports its qualification distribution", () => {
    expect(waking.qualificationAtrTravelledBackdated).toMatchObject({
      count: 1623,
      p25: 0.15574637465374513,
      median: 0.3418359801204936,
      p75: 0.6297888681311975,
      max: 6.981553384892912,
    });
  });

  it("proves the withdrawn freshness gate is absent from the decoupled funnel", () => {
    expect(waking.postFixFunnel).toMatchObject({
      totalSymbolMinutes: 914393,
      independent: {
        extension: 300449,
        minimumScore: 22393,
        dataQuality: 914393,
        velocity: 23752,
      },
      cumulative: { velocity: 664, persistence: 39 },
      actual: 39,
    });
    expect(waking.postFixFunnel.independent).not.toHaveProperty("freshness");
    expect(spec).toContain("withdrawn as a circular design error");
  });

  it("publishes the exit tradeoff frontier but no invalid compromise", () => {
    expect(exit.status).toBe("NO_ACCEPTABLE_IN_PLAY_LIVENESS_FIT");
    expect(exit.selected).toBeNull();
    const live = exit.results.find((row: any) => row.scenario.exitCore === 0.66 && row.scenario.exitPersistence === 3).splits[0];
    expect(live.settledShare).toBeCloseTo(0.6240681576);
    expect(live.scoreDecayAtDisplay.median).toBeCloseTo(17.5321309453);
    expect(live.coverage).toBeCloseTo(0.0428305400);
  });

  it("publishes the alert-verified exit policy without reactivating WAKING", () => {
    expect(thresholds.sets.sip.regular.values).toMatchObject({
      newInPlayVelocityPerMinute: 7.62,
      inPlayExitCore: 0.66,
      exitPersistenceMinutes: 15,
    });
  });

  it("keeps both separately attributable digests disclosed and non-evaluative", () => {
    for (const digest of [wakingDigest, exitDigest]) {
      expect(digest).toContain("OPTIMISTICALLY BIASED");
      expect(digest).toContain("not a performance, hit-rate");
    }
    expect(wakingDigest).toContain("WAKING gate calibration found no acceptable fit");
    expect(exitDigest).toContain("No exit frontier point met every target");
  });
});