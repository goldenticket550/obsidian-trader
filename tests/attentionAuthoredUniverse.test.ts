import { describe, expect, it } from "vitest";
import { ATTENTION_UNIVERSE } from "@/lib/attention/universe";
import {
  assertAuthoredUniverseShape,
  compactRankedByCluster,
  fetchedUniverse,
  filterRankedOutputs,
  rankableUniverse,
  resolveSectorEtf,
} from "@/lib/attention/universePolicy";

describe("trader-authored Attention Engine universe", () => {
  it("wires exactly 61 tradeable and 7 reference-only symbols", () => {
    expect(() => assertAuthoredUniverseShape(ATTENTION_UNIVERSE)).not.toThrow();
    expect(rankableUniverse(ATTENTION_UNIVERSE)).toHaveLength(61);
    expect(ATTENTION_UNIVERSE.filter((entry) => entry.referenceOnly)).toHaveLength(7);
    expect(fetchedUniverse(ATTENTION_UNIVERSE)).toHaveLength(68);
  });

  it("never lets reference-only symbols rank, display, or consume cluster caps", () => {
    const rows = [
      { symbol: "XLK", score: 100 },
      { symbol: "AAPL", score: 90 },
      { symbol: "MSFT", score: 80 },
    ];
    expect(filterRankedOutputs(rows, ATTENTION_UNIVERSE).map((row) => row.symbol)).toEqual(["AAPL", "MSFT"]);
    expect(compactRankedByCluster(rows, ATTENTION_UNIVERSE, 1).map((row) => row.symbol)).toEqual(["AAPL"]);
  });

  it("supports tradeable ETFs that also serve as another symbol's sector reference", () => {
    expect(resolveSectorEtf("NVDA", ATTENTION_UNIVERSE)?.symbol).toBe("SMH");
    expect(resolveSectorEtf("MU", ATTENTION_UNIVERSE)?.symbol).toBe("DRAM");
    expect(resolveSectorEtf("MSTR", ATTENTION_UNIVERSE)?.symbol).toBe("IBIT");
    expect(resolveSectorEtf("GDX", ATTENTION_UNIVERSE)?.symbol).toBe("GLD");
    for (const symbol of ["SMH", "DRAM", "IBIT", "GLD"]) {
      expect(ATTENTION_UNIVERSE.find((entry) => entry.symbol === symbol)).toMatchObject({ enabled: true, referenceOnly: false });
    }
  });
});
