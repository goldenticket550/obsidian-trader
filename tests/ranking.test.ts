import { describe, it, expect } from "vitest";
import { rankOpportunities, rankingScore, RANKING_RULE_DESCRIPTION } from "@/lib/scanner/ranking";
import type { WatchlistSymbol } from "@/types/watchlist";

function makeSymbol(ticker: string, score5m: number, score15m: number): WatchlistSymbol {
  return {
    ticker,
    exchange: "NASDAQ",
    price: 100,
    dailyChangePct: 0,
    distanceFromSessionLowPct: 0,
    score5m,
    score15m,
    status5m: "red",
    status15m: "red",
    lastSignalTime: null,
  };
}

describe("rankingScore", () => {
  it("takes the higher of the two timeframes, not an average", () => {
    // An average of 6 and 2 would be 4; the rule is explicitly the max.
    expect(rankingScore(makeSymbol("X", 6, 2))).toBe(6);
    expect(rankingScore(makeSymbol("Y", 2, 6))).toBe(6);
  });
});

describe("rankOpportunities", () => {
  it("orders by highest single-timeframe score descending", () => {
    const symbols = [
      makeSymbol("LOW", 1.0, 1.0),
      makeSymbol("HIGH", 8.2, 3.0),
      makeSymbol("MID", 4.5, 4.4),
    ];
    expect(rankOpportunities(symbols).map((s) => s.ticker)).toEqual(["HIGH", "MID", "LOW"]);
  });

  it("ranks on the 15m score when it is the higher of the two", () => {
    const symbols = [makeSymbol("FIVE", 5.0, 0), makeSymbol("FIFTEEN", 0, 9.0)];
    expect(rankOpportunities(symbols)[0].ticker).toBe("FIFTEEN");
  });

  it("breaks a tied best score using the weaker timeframe", () => {
    // Both peak at 8. The one that is also 7 on its other timeframe is
    // the stronger setup than the one that is 1.
    const symbols = [makeSymbol("WEAK", 8, 1), makeSymbol("BOTH", 8, 7)];
    expect(rankOpportunities(symbols).map((s) => s.ticker)).toEqual(["BOTH", "WEAK"]);
  });

  it("falls back to ticker only when both scores tie exactly", () => {
    const symbols = [makeSymbol("ZZZ", 5, 5), makeSymbol("AAA", 5, 5)];
    expect(rankOpportunities(symbols).map((s) => s.ticker)).toEqual(["AAA", "ZZZ"]);
  });

  it("applies the three keys in the documented order", () => {
    const symbols = [
      makeSymbol("BBB", 6, 6), // best 6
      makeSymbol("AAA", 9, 0), // best 9, weak 0
      makeSymbol("CCC", 9, 4), // best 9, weak 4  -> should outrank AAA
    ];
    expect(rankOpportunities(symbols).map((s) => s.ticker)).toEqual(["CCC", "AAA", "BBB"]);
  });

  it("does not mutate the input array", () => {
    const symbols = [makeSymbol("LOW", 1, 1), makeSymbol("HIGH", 9, 9)];
    const original = symbols.map((s) => s.ticker);
    rankOpportunities(symbols);
    expect(symbols.map((s) => s.ticker)).toEqual(original);
  });

  it("handles an empty watchlist", () => {
    expect(rankOpportunities([])).toEqual([]);
  });

  it("documents the rule as explicitly not a blended score", () => {
    expect(RANKING_RULE_DESCRIPTION).toMatch(/not a blended score/i);
  });
});
