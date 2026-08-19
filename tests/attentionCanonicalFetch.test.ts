import { describe, expect, it, vi } from "vitest";
import { fetchAttentionUniverse } from "@/lib/attention/fetchUniverse";
import type { MarketDataProvider } from "@/lib/market-data/types";

describe("canonical 68-symbol batch fetch", () => {
  it("fetches all tradeables and reference-only inputs in one adjusted request", async () => {
    const getCandlesMulti = vi.fn(async (request) => ({
      candlesBySymbol: Object.fromEntries(request.symbols.map((symbol: string) => [symbol, []])),
      pagination: { complete: true, pagesFetched: 1, nextPageTokenRemaining: false, truncationReason: null },
      requestedFeed: "sip",
      responseFeed: "sip",
    }));
    const provider = { name: "test", getCandles: vi.fn(), getCandlesMulti, getSessionInfo: vi.fn() } as unknown as MarketDataProvider;
    await fetchAttentionUniverse(provider, {
      timeframe: "1m",
      start: "2026-08-14T08:00:00Z",
      end: "2026-08-14T20:00:00Z",
    });
    const request = getCandlesMulti.mock.calls[0][0];
    expect(getCandlesMulti).toHaveBeenCalledOnce();
    expect(request.symbols).toHaveLength(68);
    expect(request.symbols).toEqual(expect.arrayContaining(["XLK", "XLC", "XLY", "XLP", "XLE", "XLF", "XLV", "SPCX"]));
    expect(request.adjustment).toBe("split");
  });
});
