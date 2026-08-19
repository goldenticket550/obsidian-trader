import { describe, expect, it } from "vitest";
import { assertAssetIdentity, filterBarsForListingIdentity, mergeArchiveMetadata } from "@/lib/replay/archiveMerge";
import { makeCandle } from "@/lib/fixtures/candles";
import { ARCHIVE_FORMAT_VERSION, type ArchiveMetadata } from "@/lib/replay/archive";

const metadata: ArchiveMetadata = {
  formatVersion: ARCHIVE_FORMAT_VERSION,
  createdAt: "2026-08-16T00:00:00Z",
  feed: "sip",
  feedVerification: "response_attested",
  adjustment: "split",
  start: "2025-08-15T00:00:00Z",
  end: "2026-08-15T00:00:00Z",
  symbols: ["NVDA"],
  timeframes: ["1m", "5m", "1d"],
  files: [],
};

describe("SIP archive supplement safety", () => {
  it("rejects the stale SPCX fund identity", () => {
    expect(() => assertAssetIdentity("SPCX", { symbol: "SPCX", name: "SPAC and New Issue ETF", status: "active" }, { expectedAssetName: "Space Exploration Technologies" })).toThrow(/identity mismatch/);
    expect(() => assertAssetIdentity("SPCX", { symbol: "SPCX", name: "Space Exploration Technologies Class A", status: "active" }, { expectedAssetName: "Space Exploration Technologies" })).not.toThrow();
  });

  it("removes pre-listing bars from a reused ticker", () => {
    const before = makeCandle({ time: Date.parse("2026-04-01T14:00:00Z") / 1000 });
    const after = makeCandle({ time: Date.parse("2026-06-16T14:00:00Z") / 1000 });
    expect(filterBarsForListingIdentity("SPCX", [before, after], { listedSince: "2026-06-15" })).toEqual({ candles: [after], discardedPreListingBars: 1 });
  });

  it("merges symbols and files without relabelling or colliding", () => {
    const merged = mergeArchiveMetadata(metadata, ["WDC"], [{ path: "supplement.gz", bytes: 1, bars: 2, sha256: "abc" }], "2026-08-17T00:00:00Z");
    expect(merged.symbols).toEqual(["NVDA", "WDC"]);
    expect(merged.files).toHaveLength(1);
    expect(() => mergeArchiveMetadata(metadata, ["NVDA"], [], "2026-08-17T00:00:00Z")).toThrow(/already contains/);
  });
});
