import { describe, expect, it } from "vitest";
import { classifyAttentionFreshness, type AttentionFreshnessResult } from "@/lib/attention/attentionFreshness";
import { updateAttentionCooling } from "@/lib/attention/attentionCooling";
import { assertAttentionListOrdering, buildAttentionLists } from "@/lib/attention/attentionLists";
import type { AttentionEpisode } from "@/lib/attention/attentionEpisodes";
import type { AttentionHistoryPoint } from "@/lib/attention/attentionHistory";
import type { AttentionVelocity } from "@/lib/attention/attentionVelocity";
import { ATTENTION_UNIVERSE } from "@/lib/attention/universe";

const minute = 60_000;

function point(symbol: string, at: number, score: number, overrides: Partial<AttentionHistoryPoint> = {}): AttentionHistoryPoint {
  return {
    symbol, at, score, core: score / 100, feedMode: "sip", subWindow: "regular", calibrationId: "cal",
    participationBaselineMode: "dense", participationInput: 1, participationInputKind: "z",
    displacementZ: 1, idiosyncrasyZ: 1, price: 100, atr: 2, vwap: 100, ema9: 100,
    consecutiveExpansionBars: 0, pullbackObserved: false, priceLostVwap: false,
    dataQualityState: "ok", provisional: true, rank: 1, percentile: 1, rollingZComposite: 1,
    ...overrides,
  };
}

function episode(symbol: string): AttentionEpisode {
  return {
    episodeId: `ep:${symbol}`, symbol, qualifiedAt: minute, startedAt: 0, priceAtStart: 100,
    peakAttention: 80, peakCore: 0.8, state: "active", modeTransitions: [],
    backdateTruncatedAtModeBoundary: false, backdateTruncatedAt: null, backdateTruncationReason: null,
    accelerationFailedAt: null,
    coolingStartedAt: null,
    completedAt: null,
    firstInPlayAt: null,
    inPlayEntryCount: 0,
    reentryCount: 0,
  };
}

function velocity(scoreVelocityPerMinute: number | null): AttentionVelocity {
  return {
    scoreDelta1m: scoreVelocityPerMinute, scoreDelta3m: scoreVelocityPerMinute === null ? null : scoreVelocityPerMinute * 3,
    scoreDelta5m: null, coreDelta1m: null, percentileDelta1m: null, percentileDelta3m: null,
    percentileDelta5m: null, rollingZDelta5m: null, scoreVelocityPerMinute,
    velocityEventsSuppressed: false, suppressVelocityEventsUntil: null, modeTransition: null,
    measurementWindowStartedAt: 0, measurementResetReason: null,
  };
}

function freshness(kind: AttentionFreshnessResult["freshness"], atrTravelledSinceStart = 0.5): AttentionFreshnessResult {
  return {
    freshness: kind, minutesSinceEpisodeStart: 5, atrTravelledSinceStart,
    distanceFromVwapAtr: 0.2, distanceFromEma9Atr: 0.2, consecutiveExpansionBars: 1,
    pullbackObserved: false, reasons: ["test"],
  };
}

describe("A3 freshness, cooling, and the IN PLAY list", () => {
  it("classifies freshness only from episode price/time evidence", () => {
    const ep = episode("AAA");
    expect(classifyAttentionFreshness(ep, point("AAA", 5 * minute, 50)).freshness).toBe("Fresh");
    expect(classifyAttentionFreshness(ep, point("AAA", 12 * minute, 55, { price: 101.2 })).freshness).toBe("Developing");
    expect(classifyAttentionFreshness(ep, point("AAA", 35 * minute, 60, { pullbackObserved: true })).freshness).toBe("Mature");
    const extended = classifyAttentionFreshness(ep, point("AAA", 20 * minute, 80, { price: 104.2, ema9: 100.5 }));
    expect(extended.freshness).toBe("Extended");
    expect(extended.atrTravelledSinceStart).toBeCloseTo(2.1);
  });

  it("publishes D1: VWAP distance, travel, and expansion never classify Extended", () => {
    const ep = episode("AAA");
    const result = classifyAttentionFreshness(ep, point("AAA", 20 * minute, 80, {
      price: 104.2, ema9: 104, vwap: 100, consecutiveExpansionBars: 5,
    }));
    expect(result.freshness).toBe("Mature");
    expect(result.atrTravelledSinceStart).toBeGreaterThan(2);
    expect(result.distanceFromVwapAtr).toBeGreaterThan(2);
    expect(result.consecutiveExpansionBars).toBe(5);
    expect(result.reasons).not.toContain("atr_travel_extended");
    expect(result.reasons).not.toContain("vwap_distance_extended");
    expect(result.reasons).not.toContain("uninterrupted_expansion_extended");
  });
  it("classifies a failed acceleration without emitting a short signal or a new episode", () => {
    const before = point("AAA", 0, 50, { participationInput: 1, displacementZ: 1 });
    const spike = point("AAA", minute, 58, { participationInput: 1.5, displacementZ: 1.05 });
    const armed = updateAttentionCooling({ previousMemory: null, previousPoint: before, point: spike, velocity: velocity(3) });
    expect(armed.memory.armedAt).toBe(minute);
    expect(armed.accelerationFailed).toBe(false);
    const collapse = point("AAA", 2 * minute, 42, {
      participationInput: 1.6, displacementZ: 1.10, price: 99, vwap: 100, priceLostVwap: true,
    });
    const failed = updateAttentionCooling({ previousMemory: armed.memory, previousPoint: spike, point: collapse, velocity: velocity(-16) });
    expect(failed.classification).toBe("ACCELERATION_FAILED");
    expect(failed.evidence).toEqual({
      velocitySpiked: false,
      participationRose: false,
      displacementFailedToFollow: true,
      priceLostVwap: true,
      attentionCollapsed: true,
    });
    expect(failed).not.toHaveProperty("shortSignal");
  });

  it("sorts IN PLAY by score and retains Mature/Extended freshness labels", () => {
    const symbols = ["SMCI", "DELL", "NBIS", "CRWV", "AAOI"];
    const scores = [80, 79, 78, 77, 76];
    const velocities = [2.1, 2.2, 2.3, 2.4, 3.9];
    const freshnesses: AttentionFreshnessResult["freshness"][] = ["Fresh", "Extended", "Developing", "Mature", "Fresh"];
    const rows = symbols.map((symbol, index) => ({
      symbol,
      point: point(symbol, 10 * minute, scores[index], { rank: index + 1 }),
      state: "IN_PLAY" as const,
      statePersistenceMinutes: 3,
      pendingTransition: "none" as const,
      pendingTransitionMinutes: 0,
      stateExplanation: "held in IN PLAY",
      episode: episode(symbol),
      freshness: freshness(freshnesses[index]),
      velocity: velocity(velocities[index]),
      dataQualityState: "ok" as const,
    }));
    const lists = buildAttentionLists(rows, ATTENTION_UNIVERSE);
    expect(lists.inPlay.map((row) => row.symbol)).toEqual(symbols);
    expect(lists.inPlay.find((row) => row.symbol === "DELL")?.freshness?.freshness).toBe("Extended");
    expect(lists.inPlay.find((row) => row.symbol === "CRWV")?.freshness?.freshness).toBe("Mature");
    expect(lists.inPlayDisplay.visibleRows.map((row) => row.symbol)).toEqual(["SMCI", "DELL", "NBIS"]);
    expect(lists.inPlayDisplay.overflow).toContainEqual({ cluster: "ai_infra", hiddenCount: 2, hiddenSymbols: ["CRWV", "AAOI"], label: "+2 more in ai_infra" });
    expect(lists.inPlayDisplay.engineRows).toHaveLength(5);
    expect(() => assertAttentionListOrdering({ ...lists, inPlay: [...lists.inPlay].reverse() })).toThrow(/I5 LIST ORDERING/);
  });

});
