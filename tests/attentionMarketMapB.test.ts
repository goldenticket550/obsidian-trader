import { describe, expect, it } from "vitest";
import {
  buildMarketMap,
  buildUniverseMarketMaps,
  DEFAULT_MARKET_MAP_CONFIG,
  type MarketMapInput,
} from "@/lib/attention/marketMap";
import type { Candle } from "@/types/candle";

const seconds = (iso: string) => Date.parse(iso) / 1000;
const bar = (
  iso: string,
  close: number,
  high = close + 0.2,
  low = close - 0.2,
  volume = 1_000,
): Candle => ({
  time: seconds(iso),
  open: close,
  high,
  low,
  close,
  volume,
});

function baseInput(
  at: string,
  oneMinuteBars: Candle[],
  fiveMinuteBars: Candle[] = [],
): MarketMapInput {
  return {
    symbol: "NVDA",
    tradingDate: "2026-08-14",
    at: Date.parse(at),
    oneMinuteBars,
    fiveMinuteBars,
    priorDailyBar: bar("2026-08-13T16:00:00-04:00", 98, 101, 96, 2_000),
    atr: 2,
    expectedSessionMove: 5,
  };
}

describe("Phase B Market Map", () => {
  it("anchors the opening range to 09:30 ET and never shifts to the first received bar", () => {
    const bars = [
      bar("2026-08-14T08:00:00-04:00", 99),
      // 09:30 is deliberately missing.
      bar("2026-08-14T09:31:00-04:00", 100, 101, 99),
      bar("2026-08-14T09:44:00-04:00", 102, 103, 100),
      bar("2026-08-14T09:45:00-04:00", 101),
    ];
    const beforeClose = buildMarketMap(
      baseInput("2026-08-14T09:44:00-04:00", bars),
    );
    expect(beforeClose.levels.some((level) => level.kind === "ORH")).toBe(
      false,
    );
    const closed = buildMarketMap(baseInput("2026-08-14T09:45:00-04:00", bars));
    expect(closed.levels.find((level) => level.kind === "ORH")?.price).toBe(
      103,
    );
    expect(closed.levels.find((level) => level.kind === "ORL")?.price).toBe(99);
  });

  it("keeps literal HOD/LOD separate from filtered, causally confirmed swings", () => {
    const oneMinute = [
      bar("2026-08-14T09:30:00-04:00", 10),
      bar("2026-08-14T10:00:00-04:00", 11),
    ];
    const fiveMinute = [
      bar("2026-08-14T09:30:00-04:00", 10, 10, 9),
      bar("2026-08-14T09:35:00-04:00", 11, 12, 10),
      bar("2026-08-14T09:40:00-04:00", 10, 10.5, 9.5),
      bar("2026-08-14T09:45:00-04:00", 11, 11.5, 10),
      bar("2026-08-14T09:50:00-04:00", 12, 13, 11),
      bar("2026-08-14T09:55:00-04:00", 11, 11.5, 10.5),
    ];
    const map = buildMarketMap(
      {
        ...baseInput("2026-08-14T10:00:00-04:00", oneMinute, fiveMinute),
        atr: 1,
      },
      {
        ...DEFAULT_MARKET_MAP_CONFIG,
        pivotLength: 1,
        minimumSwingAtr: 0.5,
        minimumSwingMinutes: 15,
      },
    );
    expect(map.levels.some((level) => level.kind === "HOD")).toBe(true);
    expect(
      map.levels
        .filter((level) => level.kind === "SWING_HIGH")
        .map((level) => level.price),
    ).toEqual([12, 13]);
  });

  it("lets observed PMH reactions outlive decaying automatic premarket priority", () => {
    const initial = [
      bar("2026-08-14T08:00:00-04:00", 99, 100, 98),
      bar("2026-08-14T09:30:00-04:00", 99, 99.5, 98.5),
      bar("2026-08-14T10:00:00-04:00", 99, 100, 98.8, 2_000),
    ];
    const later = [
      ...initial,
      bar("2026-08-14T11:00:00-04:00", 99, 100, 98.7, 3_000),
      bar("2026-08-14T12:00:00-04:00", 99, 100, 98.6, 4_000),
      bar("2026-08-14T13:00:00-04:00", 99, 100, 98.5, 5_000),
    ];
    const atTen = buildMarketMap(
      baseInput("2026-08-14T10:00:00-04:00", initial),
    ).levels.find((level) => level.kind === "PMH")!;
    const atOne = buildMarketMap(
      baseInput("2026-08-14T13:00:00-04:00", later),
    ).levels.find((level) => level.kind === "PMH")!;
    expect(atOne.relevance.automaticPriority).toBeLessThan(
      atTen.relevance.automaticPriority,
    );
    expect(atOne.relevance.reactionCount).toBeGreaterThan(
      atTen.relevance.reactionCount,
    );
    expect(atOne.relevance.score).toBeGreaterThan(atTen.relevance.score);
  });

  it("publishes nearest and next references without deterministic target language", () => {
    const bars = [
      bar("2026-08-14T08:00:00-04:00", 99, 100, 98),
      bar("2026-08-14T09:30:00-04:00", 99),
      bar("2026-08-14T09:45:00-04:00", 99),
    ];
    const map = buildMarketMap(baseInput("2026-08-14T09:45:00-04:00", bars));
    for (const reference of [
      map.nearestUpside,
      map.nextUpside,
      map.nearestDownside,
      map.nextDownside,
    ].filter(Boolean)) {
      expect(reference!.label).toMatch(
        /^(Nearest|Next) (upside|downside) reference:/,
      );
      expect(reference!.label.toLowerCase()).not.toContain("target");
      expect(reference!.distancePct).toBeGreaterThan(0);
    }
  });

  it("maintains cheap state for every symbol and detailed maps only for the active subset", () => {
    const bars = [
      bar("2026-08-14T09:30:00-04:00", 99),
      bar("2026-08-14T09:45:00-04:00", 100),
    ];
    const nvda = baseInput("2026-08-14T09:45:00-04:00", bars);
    const amd = { ...nvda, symbol: "AMD" };
    const maps = buildUniverseMarketMaps([nvda, amd], new Set(["AMD"]));
    expect(Object.keys(maps.cheapBySymbol).sort()).toEqual(["AMD", "NVDA"]);
    expect(Object.keys(maps.detailedBySymbol)).toEqual(["AMD"]);
  });

  it("is deterministic and cannot read bars after the evaluation timestamp", () => {
    const bars = [
      bar("2026-08-14T09:30:00-04:00", 99, 100, 98),
      bar("2026-08-14T09:45:00-04:00", 100, 101, 99),
      bar("2026-08-14T10:30:00-04:00", 150, 160, 149),
    ];
    const input = baseInput("2026-08-14T09:45:00-04:00", bars);
    const first = buildMarketMap(input);
    const second = buildMarketMap(input);
    expect(first).toEqual(second);
    expect(first.hod).toBe(101);
    expect(first.price).toBe(100);
  });

  it("rejects opening-range definitions outside the canonical 5/15/30 choices", () => {
    const bars = [bar("2026-08-14T09:30:00-04:00", 99)];
    expect(() =>
      buildMarketMap(baseInput("2026-08-14T09:30:00-04:00", bars), {
        ...DEFAULT_MARKET_MAP_CONFIG,
        openingRangeMinutes: 10 as 15,
      }),
    ).toThrow(/Opening range must be 5, 15, or 30/);
  });
});
