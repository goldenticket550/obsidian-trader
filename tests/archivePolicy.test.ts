import { describe, expect, it } from "vitest";
import { DEFAULT_BAR_ADJUSTMENT } from "@/lib/market-data/types";
import {
  ARCHIVE_FORMAT_VERSION,
  assertArchiveMatchesLive,
  assertEmpiricalFeedRatios,
  assertHistoricalSipWindow,
  assertSipResponseFeed,
  LIVE_BAR_ADJUSTMENT,
  PRE_STREAM_REPLAY_DISCLOSURE,
  stableJson,
  type ArchiveMetadata,
} from "@/lib/replay/archive";

const metadata = (adjustment = LIVE_BAR_ADJUSTMENT): ArchiveMetadata => ({
  formatVersion: ARCHIVE_FORMAT_VERSION,
  createdAt: "2026-08-16T00:00:00.000Z",
  feed: "sip",
  feedVerification: "response_attested",
  adjustment,
  start: "2025-08-15T00:00:00.000Z",
  end: "2026-08-15T00:00:00.000Z",
  symbols: ["NVDA"],
  timeframes: ["1m", "5m", "1d"],
  files: [],
});

describe("archive safety policy", () => {
  it("uses the same split adjustment for archive and live requests", () => {
    expect(LIVE_BAR_ADJUSTMENT).toBe("split");
    expect(DEFAULT_BAR_ADJUSTMENT).toBe(LIVE_BAR_ADJUSTMENT);
    expect(() => assertArchiveMatchesLive(metadata())).not.toThrow();
    expect(() => assertArchiveMatchesLive(metadata("raw"))).toThrow(/does not match live/);
  });

  it("rejects an end inside the free historical SIP delay window before fetching", () => {
    const now = Date.parse("2026-08-16T15:00:00.000Z");
    expect(() => assertHistoricalSipWindow("2026-08-16T14:46:00.000Z", now)).toThrow(/15 minutes/);
    expect(() => assertHistoricalSipWindow("2026-08-16T14:45:00.000Z", now)).not.toThrow();
  });

  it("requires explicit, response-attested SIP provenance", () => {
    expect(() => assertSipResponseFeed("sip", "sip")).not.toThrow();
    expect(() => assertSipResponseFeed("iex", "iex")).toThrow(/must be sip/);
    expect(() => assertSipResponseFeed("sip", "iex")).toThrow(/Unexpected/);
    expect(() => assertSipResponseFeed("sip", null)).toThrow(/unverifiable/);
  });

  it("requires empirical SIP/IEX volume ratios to remain inside the configured discriminator band", () => {
    const observation = { symbol: "NVDA", sipVolume: 27_000, iexVolume: 1_000, ratio: 27 };
    expect(() => assertEmpiricalFeedRatios([observation], 8, 60)).not.toThrow();
    expect(() => assertEmpiricalFeedRatios([{ ...observation, ratio: 7.9 }], 8, 60)).toThrow(/outside/);
    expect(() => assertEmpiricalFeedRatios([{ ...observation, ratio: 60.1 }], 8, 60)).toThrow(/outside/);
    expect(() => assertEmpiricalFeedRatios([], 8, 60)).toThrow(/requires observations/);
  });

  it("preserves the mandatory disclosure verbatim", () => {
    expect(PRE_STREAM_REPLAY_DISCLOSURE).toBe(
      "Timing statistics derived from historical pulls assume instantaneous bar availability. " +
      "Real arrival latency is not represented. Human-relative latency and move-capture figures " +
      "are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds."
    );
  });

  it("omits undefined object properties without producing invalid JSON", () => {
    const serialized = stableJson({ required: "sip", optional: undefined, array: [1, undefined] });
    expect(JSON.parse(serialized)).toEqual({ array: [1, null], required: "sip" });
  });
});
