import { describe, it, expect } from "vitest";
import { detectMomentumLadder, type MilestoneState } from "@/lib/indicators/momentumLadder";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { makeCandle } from "@/lib/fixtures/candles";
import type { Candle } from "@/types/candle";

const config = defaultStrategyConfig.momentumLadder;

/** Anchor candle opens at 100, so tier N% sits at price 100 × (1 + N/100). */
function anchor(): Candle {
  return makeCandle({ time: 0, open: 100, high: 100, low: 100, close: 100 });
}
function bar(i: number, close: number, high = close): Candle {
  return makeCandle({ time: i * 300, open: close, high, low: Math.min(close, high) - 0.5, close });
}
function stateOf(tiers: { tierPct: number; state: MilestoneState }[], pct: number): MilestoneState {
  return tiers.find((t) => t.tierPct === pct)!.state;
}

describe("Rule B1 — anchor, move, and insufficient data", () => {
  it("uses the five configured percent tiers", () => {
    expect(config.tiers).toEqual([3, 5, 8, 10, 15]);
  });

  it("reports insufficientData with no candle beyond the anchor", () => {
    const r = detectMomentumLadder([anchor()], config);
    expect(r.insufficientData).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.anchorPrice).toBeNull();
  });

  it("reports insufficientData on an empty series", () => {
    expect(detectMomentumLadder([], config).insufficientData).toBe(true);
  });

  it("anchors to the session open and reports both percent and dollar move", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 106)], config);
    expect(r.anchorPrice).toBe(100);
    expect(r.currentMovePct).toBeCloseTo(6, 5);
    expect(r.currentMoveDollars).toBeCloseTo(6, 5);
  });

  it("keeps the anchor immutable as later candles move", () => {
    // A later, much lower candle must not re-anchor the ladder.
    const r = detectMomentumLadder([anchor(), bar(1, 108), bar(2, 90)], config);
    expect(r.anchorPrice).toBe(100);
  });
});

describe("Rule B2 — per-milestone state machine", () => {
  it("not_reached when price never approaches the tier", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 101)], config);
    expect(stateOf(r.tiers, 3)).toBe("not_reached");
  });

  it("holding requires a completed close at or beyond the tier", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 103)], config);
    expect(stateOf(r.tiers, 3)).toBe("holding");
  });

  it("rejected when touched intrabar but closed back below, never having held", () => {
    // High reaches 103 (the 3% tier) but the close is 102.
    const r = detectMomentumLadder([anchor(), bar(1, 102, 103.5)], config);
    expect(stateOf(r.tiers, 3)).toBe("rejected");
  });

  it("a wick alone can reach a tier without holding it", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 101, 105.2)], config);
    expect(stateOf(r.tiers, 5)).toBe("rejected"); // touched 105, closed 101
    expect(stateOf(r.tiers, 8)).toBe("not_reached"); // never touched 108
  });

  it("lost after holding, when a completed candle closes back below", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 104), bar(2, 101)], config);
    expect(stateOf(r.tiers, 3)).toBe("lost");
  });

  it("reclaimed after being lost, on a later close back at/above", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 104), bar(2, 101), bar(3, 105)], config);
    expect(stateOf(r.tiers, 3)).toBe("reclaimed");
  });

  it("tracks each tier independently", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 106)], config);
    expect(stateOf(r.tiers, 3)).toBe("holding");
    expect(stateOf(r.tiers, 5)).toBe("holding");
    expect(stateOf(r.tiers, 8)).toBe("not_reached");
  });

  it("records first-reached and last-transition timestamps", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 104), bar(2, 101)], config);
    const tier3 = r.tiers.find((t) => t.tierPct === 3)!;
    expect(tier3.firstReachedAt).toBe(300);
    expect(tier3.lastTransitionAt).toBe(600);
  });
});

describe("Rule B2 — explicitly invalid transitions are prevented", () => {
  it("never goes lost before holding", () => {
    // Price stays below the tier the whole way: no hold ever happened, so
    // dipping cannot produce `lost`.
    const r = detectMomentumLadder([anchor(), bar(1, 101), bar(2, 100.5)], config);
    expect(stateOf(r.tiers, 3)).not.toBe("lost");
    expect(stateOf(r.tiers, 3)).toBe("not_reached");
  });

  it("never goes reclaimed before lost", () => {
    // Touched then closed below (rejected), then closes above. That is a
    // first genuine hold, not a reclaim — reclaim requires a prior loss.
    const r = detectMomentumLadder([anchor(), bar(1, 102, 103.5), bar(2, 104)], config);
    expect(stateOf(r.tiers, 3)).toBe("holding");
    expect(stateOf(r.tiers, 3)).not.toBe("reclaimed");
  });

  it("never goes rejected after holding", () => {
    // Held, then a candle that touches the tier but closes below. Having
    // already held, the correct state is `lost`, never back to `rejected`.
    const r = detectMomentumLadder([anchor(), bar(1, 104), bar(2, 101, 103.9)], config);
    expect(stateOf(r.tiers, 3)).toBe("lost");
    expect(stateOf(r.tiers, 3)).not.toBe("rejected");
  });

  it("survives a pullback that would reset consecutiveBullish's strict streak", () => {
    // One red candle mid-move: the tier is lost then reclaimed, and the
    // ladder still reports a holding milestone — the whole point of B.
    const r = detectMomentumLadder(
      [anchor(), bar(1, 106), bar(2, 104.5), bar(3, 107)],
      config
    );
    expect(r.passed).toBe(true);
    expect(r.highestHoldingTier).toBe(5);
  });
});

describe("Rule B3 — summary reports the highest holding/reclaimed tier", () => {
  it("reports the highest tier currently holding", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 111)], config);
    expect(r.highestHoldingTier).toBe(10);
    expect(r.passed).toBe(true);
  });

  it("counts a reclaimed tier as holding for the summary", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 106), bar(2, 101), bar(3, 106)], config);
    expect(stateOf(r.tiers, 5)).toBe("reclaimed");
    expect(r.highestHoldingTier).toBe(5);
  });

  it("does not count a lost tier as holding", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 106), bar(2, 101)], config);
    expect(r.highestHoldingTier).toBeNull();
    expect(r.passed).toBe(false);
  });

  it("reports highestMilestoneReached separately from what is holding", () => {
    // Reached 8% intrabar, lost it, currently holding only 3%.
    const r = detectMomentumLadder([anchor(), bar(1, 104, 108.5), bar(2, 104)], config);
    expect(r.highestMilestoneReached).toBe(8);
    expect(r.highestHoldingTier).toBe(3);
  });

  it("shows both percent and dollar forms, plus the next milestone", () => {
    const r = detectMomentumLadder([anchor(), bar(1, 106)], config);
    expect(r.detail).toContain("Holding +5% ($5.00)");
    expect(r.detail).toContain("session open $100.00 → current $106.00");
    expect(r.detail).toContain("Next milestone: +8% ($108.00)");
  });

  it("says so honestly when nothing is holding", () => {
    expect(detectMomentumLadder([anchor(), bar(1, 101)], config).detail).toContain(
      "No milestone currently holding"
    );
  });
});
