import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_ATTENTION_EVENT_CONFIG } from "@/lib/attention/attentionEvents";

const artifact = JSON.parse(readFileSync("data/replay/reports/phase-c-empirical-gate-diagnostics.json", "utf8"));
const report = readFileSync("data/replay/reports/phase-c-empirical-gate-diagnostics.md", "utf8");

describe("Phase C empirical gate diagnostics", () => {
  it("compares all freshness definitions on five and forty sessions without publishing", () => {
    expect(artifact.status).toBe("DIAGNOSTIC_ONLY_NOT_PUBLISHED");
    expect(artifact.freshness.fiveSessions).toMatchObject({
      D1_EMA9_ONLY: { total: 47, counts: { Fresh: 0, Developing: 16, Mature: 7, Extended: 24 }, notExtended: 23 },
      D2_EMA9_OR_TRAVEL: { total: 47, counts: { Fresh: 0, Developing: 16, Mature: 4, Extended: 27 }, notExtended: 20 },
      D3_CURRENT: { total: 47, counts: { Fresh: 0, Developing: 1, Mature: 1, Extended: 45 }, notExtended: 2 },
    });
    expect(artifact.freshness.fullCorpus).toMatchObject({
      D1_EMA9_ONLY: { total: 266, counts: { Fresh: 1, Developing: 75, Mature: 61, Extended: 129 }, notExtended: 137 },
      D2_EMA9_OR_TRAVEL: { total: 266, counts: { Fresh: 1, Developing: 75, Mature: 36, Extended: 154 }, notExtended: 112 },
      D3_CURRENT: { total: 266, counts: { Fresh: 1, Developing: 3, Mature: 5, Extended: 257 }, notExtended: 9 },
    });
  });

  it("runs distribution-derived relevance floors through semantic transitions", () => {
    expect(artifact.keyLevel.map((row: any) => ({
      percentile: row.percentile, floor: row.floor, relevant: row.funnel.withRelevantLevel,
      transitions: row.funnel.semanticTransition, novel: row.funnel.novelIdentity, emitted: row.emitted,
    }))).toEqual([
      { percentile: "p75", floor: 77.44444444444444, relevant: 1518, transitions: 125, novel: 89, emitted: 21 },
      { percentile: "p90", floor: 84.11111111111111, relevant: 1063, transitions: 89, novel: 64, emitted: 15 },
      { percentile: "p95", floor: 84.72222222222223, relevant: 870, transitions: 83, novel: 59, emitted: 14 },
    ]);
    expect(artifact.recommendations.keyLevel).toMatchObject({ floor: 84.11111111111111, status: "for_trader_adjudication_only" });
  });

  it("reproduces the current ACCELERATION result and exposes the persistence tradeoff", () => {
    const find = (persistence: number, definition: string) => artifact.acceleration.find((row: any) => row.persistenceMinutes === persistence && row.definition === definition).funnel;
    expect(find(2, "D3_CURRENT")).toMatchObject({ persistence: 8, extension: 1, potentialEvents: 1 });
    expect(find(2, "D1_EMA9_ONLY")).toMatchObject({ persistence: 8, extension: 6, potentialEvents: 4 });
    expect(find(1, "D1_EMA9_ONLY")).toMatchObject({ persistence: 95, extension: 87, potentialEvents: 52 });
    expect(artifact.recommendations.acceleration).toMatchObject({
      status: "VIABLE_AS_RARE_TWO_MINUTE_D1_CANDIDATE", published: false,
      potentialEventsAcrossFiveSessions: 4, oneMinuteCandidateEvents: 52,
    });
  });

  it("preserves the pre-publication diagnostic identity while active policy adopts p90", () => {
    expect(DEFAULT_ATTENTION_EVENT_CONFIG).toMatchObject({ keyLevelMinimumRelevance: 84.11111111111111, accelerationPersistenceMinutes: 2 });
    expect(artifact.activePolicyUnchanged).toEqual({ freshness: "D3_CURRENT", keyLevelMinimumRelevance: 90, accelerationPersistenceMinutes: 2 });
    expect(artifact.groundTruthValidation).toBe("REFUSED");
    expect(artifact.disclosure).toContain("OPTIMISTICALLY BIASED");
    expect(report).toContain("Diagnostic only");
    expect(report).toContain("Recommendations — not published");
  });
});