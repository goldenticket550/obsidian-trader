// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarketMapPanel } from "@/components/dashboard/MarketMapPanel";
import type { MarketMapSnapshot } from "@/lib/attention/marketMap";

describe("MarketMapPanel", () => {
  afterEach(cleanup);

  it("renders references as locations and exposes relevance evidence", () => {
    const relevance = {
      score: 72,
      automaticPriority: 0,
      reactionCount: 3,
      reclaimCount: 1,
      volumeAtInteractionRatio: 1.4,
      rejectionStrengthAtr: 0.8,
      lastInteractionAt: 1,
      stillUnbroken: true,
    };
    const map: MarketMapSnapshot = {
      symbol: "NVDA",
      tradingDate: "2026-08-14",
      at: 1,
      price: 100,
      vwap: 99,
      hod: 101,
      lod: 98,
      atr: 2,
      expectedSessionMove: 5,
      openingRangeMinutes: 15,
      levels: [
        {
          id: "pdh",
          kind: "PDH",
          price: 102,
          availableFrom: 1,
          dynamic: false,
          relevance,
        },
      ],
      nearestUpside: {
        label: "Nearest upside reference: PDH",
        levelId: "pdh",
        kind: "PDH",
        price: 102,
        distancePct: 2,
        distanceAtr: 1,
        expectedMoveFraction: 0.4,
        relevanceScore: 72,
      },
      nextUpside: null,
      nearestDownside: null,
      nextDownside: null,
    };
    render(<MarketMapPanel map={map} />);
    expect(screen.getByText(/Nearest upside reference: PDH/)).toBeTruthy();
    expect(screen.getByText(/References describe location/)).toBeTruthy();
    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.queryByText(/will target/i)).toBeNull();
  });
});
