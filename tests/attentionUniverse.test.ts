import { describe, expect, it } from "vitest";
import { filterRankedOutputs, resolveSectorEtf, validateUniverse, type UniverseSymbol } from "@/lib/attention/universePolicy";

const universe: UniverseSymbol[] = [
  { symbol: "QQQ", benchmark: "QQQ", sectorEtf: null, cluster: "benchmark", optionsTier: 1, enabled: false, referenceOnly: true },
  { symbol: "SMH", benchmark: "QQQ", sectorEtf: null, cluster: "semis", optionsTier: 1, enabled: true, referenceOnly: false },
  { symbol: "DRAM", benchmark: "QQQ", sectorEtf: "SMH", cluster: "memory", optionsTier: 1, enabled: true, referenceOnly: false },
  { symbol: "NVDA", benchmark: "QQQ", sectorEtf: "SMH", cluster: "semis", optionsTier: 1, enabled: true, referenceOnly: false },
];

describe("typed configured universe", () => {
  it("never emits a reference-only symbol in any candidate output", () => {
    validateUniverse(universe);
    const rows = [{ symbol: "QQQ", score: 99 }, { symbol: "NVDA", score: 80 }];
    expect(filterRankedOutputs(rows, universe)).toEqual([{ symbol: "NVDA", score: 80 }]);
  });

  it("resolves a sector ETF that is itself enabled and tradeable", () => {
    expect(resolveSectorEtf("NVDA", universe)).toMatchObject({ symbol: "SMH", enabled: true, referenceOnly: false });
    expect(resolveSectorEtf("DRAM", universe)?.symbol).toBe("SMH");
  });

  it("rejects a reference-only symbol that could accidentally become rankable", () => {
    expect(() => validateUniverse(universe.map((entry) => entry.symbol === "QQQ" ? { ...entry, enabled: true } : entry))).toThrow(/enabled:false/);
  });
});
