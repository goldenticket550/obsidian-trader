import { describe, expect, it, vi } from "vitest";
import { fetchConfiguredUniverse } from "@/lib/attention/fetchUniverse";
import type { UniverseSymbol } from "@/lib/attention/universePolicy";
import type { MarketDataProvider } from "@/lib/market-data/types";

const universe: UniverseSymbol[] = [
  { symbol: "QQQ", benchmark: "QQQ", sectorEtf: null, cluster: "benchmark", optionsTier: 1, enabled: false, referenceOnly: true },
  { symbol: "NVDA", benchmark: "QQQ", sectorEtf: "QQQ", cluster: "semis", optionsTier: 1, enabled: true, referenceOnly: false },
];

describe("mandatory configured-universe batch fetch", () => {
  it("fetches tradeable and reference-only symbols in one multi-symbol call", async () => {
    const getCandlesMulti = vi.fn(async (request) => ({
      candlesBySymbol: Object.fromEntries(request.symbols.map((symbol: string) => [symbol, []])),
      pagination: { complete: true, pagesFetched: 1, nextPageTokenRemaining: false, truncationReason: null },
      requestedFeed: "sip",
      responseFeed: "sip",
    }));
    const provider = { name: "test", getCandles: vi.fn(), getCandlesMulti, getSessionInfo: vi.fn() } as unknown as MarketDataProvider;
    await fetchConfiguredUniverse(provider, universe, { timeframe: "1m", start: "2026-08-14T08:00:00Z", end: "2026-08-14T20:00:00Z" });
    expect(getCandlesMulti).toHaveBeenCalledOnce();
    expect(getCandlesMulti.mock.calls[0][0]).toMatchObject({ symbols: ["QQQ", "NVDA"], adjustment: "split" });
  });

  it("refuses a provider without the batch path", async () => {
    const provider = { name: "single", getCandles: vi.fn(), getSessionInfo: vi.fn() } as unknown as MarketDataProvider;
    await expect(fetchConfiguredUniverse(provider, universe, { timeframe: "1m", start: "2026-08-14T08:00:00Z", end: "2026-08-14T20:00:00Z" })).rejects.toThrow(/multi-symbol/);
  });
});
