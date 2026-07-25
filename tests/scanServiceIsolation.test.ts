import { describe, it, expect } from "vitest";
import { scanWatchlistWithProvider } from "@/lib/scanner/scanService";
import type { MarketDataProvider, GetCandlesParams } from "@/lib/market-data/types";
import type { CandleSeries } from "@/types/candle";
import { flatSeries } from "@/lib/fixtures/candles";

function makeGoodSeries(symbol: string, timeframe: GetCandlesParams["timeframe"]): CandleSeries {
  return {
    symbol,
    timeframe,
    quality: "simulated",
    candles: timeframe === "1d" ? flatSeries(20, 100) : flatSeries(30, 100),
  };
}

/** A fake provider where one specific symbol always throws, simulating a
 * transient failure, bad ticker, or rate limit hit on just that symbol. */
function makeProviderWithOneFailingSymbol(failingSymbol: string): MarketDataProvider {
  return {
    name: "fake",
    async getCandles(params: GetCandlesParams): Promise<CandleSeries> {
      if (params.symbol === failingSymbol) {
        throw new Error(`Simulated provider failure for ${failingSymbol}`);
      }
      return makeGoodSeries(params.symbol, params.timeframe);
    },
    async getSessionInfo() {
      return { isOpen: true, session: "regular" as const, nextOpenTime: null };
    },
  };
}

describe("scanWatchlistWithProvider - per-symbol isolation (Codex regression)", () => {
  it("continues scanning other symbols when one symbol's provider call fails", async () => {
    const provider = makeProviderWithOneFailingSymbol("BADTICKER");
    const symbols = [
      { symbol: "NVDA", exchange: "NASDAQ" },
      { symbol: "BADTICKER", exchange: "NASDAQ" },
      { symbol: "AAPL", exchange: "NASDAQ" },
    ];

    const result = await scanWatchlistWithProvider(symbols, provider);

    // The two good symbols still succeeded despite the bad one.
    expect(result.watchlist.map((w) => w.ticker).sort()).toEqual(["AAPL", "NVDA"]);
    expect(result.resultsBySymbol["NVDA"]).toBeDefined();
    expect(result.resultsBySymbol["AAPL"]).toBeDefined();
  });

  it("reports the failed symbol in errors with a real message, not silently", async () => {
    const provider = makeProviderWithOneFailingSymbol("BADTICKER");
    const symbols = [
      { symbol: "NVDA", exchange: "NASDAQ" },
      { symbol: "BADTICKER", exchange: "NASDAQ" },
    ];

    const result = await scanWatchlistWithProvider(symbols, provider);

    expect(result.errors.length).toBe(1);
    expect(result.errors[0].symbol).toBe("BADTICKER");
    expect(result.errors[0].message).toContain("Simulated provider failure");
  });

  it("never includes the failed symbol in the watchlist or results - no fabricated fallback data", async () => {
    const provider = makeProviderWithOneFailingSymbol("BADTICKER");
    const symbols = [{ symbol: "BADTICKER", exchange: "NASDAQ" }];

    const result = await scanWatchlistWithProvider(symbols, provider);

    expect(result.watchlist.length).toBe(0);
    expect(result.resultsBySymbol["BADTICKER"]).toBeUndefined();
  });

  it("returns an empty errors array when every symbol succeeds", async () => {
    const provider = makeProviderWithOneFailingSymbol("NONEXISTENT_SYMBOL_THAT_NEVER_MATCHES");
    const symbols = [
      { symbol: "NVDA", exchange: "NASDAQ" },
      { symbol: "AAPL", exchange: "NASDAQ" },
    ];

    const result = await scanWatchlistWithProvider(symbols, provider);
    expect(result.errors).toEqual([]);
  });

  it("handles multiple failing symbols independently, all reported", async () => {
    const provider: MarketDataProvider = {
      name: "fake",
      async getCandles(params: GetCandlesParams): Promise<CandleSeries> {
        if (params.symbol === "BAD1" || params.symbol === "BAD2") {
          throw new Error(`Failure for ${params.symbol}`);
        }
        return makeGoodSeries(params.symbol, params.timeframe);
      },
      async getSessionInfo() {
        return { isOpen: true, session: "regular" as const, nextOpenTime: null };
      },
    };

    const symbols = [
      { symbol: "BAD1", exchange: "NASDAQ" },
      { symbol: "GOOD1", exchange: "NASDAQ" },
      { symbol: "BAD2", exchange: "NASDAQ" },
    ];

    const result = await scanWatchlistWithProvider(symbols, provider);

    expect(result.watchlist.map((w) => w.ticker)).toEqual(["GOOD1"]);
    expect(result.errors.map((e) => e.symbol).sort()).toEqual(["BAD1", "BAD2"]);
  });
});
