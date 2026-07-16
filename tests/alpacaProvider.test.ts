import { describe, it, expect, vi, afterEach } from "vitest";
import { mapAlpacaBar, AlpacaProvider, computeStartDate } from "@/lib/market-data/providers/alpacaProvider";

describe("computeStartDate", () => {
  it("looks back several calendar days for intraday timeframes", () => {
    const now = new Date("2026-07-13T14:00:00Z"); // a Monday
    const start = new Date(computeStartDate(now, "5m", 100));
    const daysBack = (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    // Must reach back far enough to cross the prior weekend comfortably.
    expect(daysBack).toBeGreaterThanOrEqual(3);
  });

  it("reaches back further for daily candles with a large limit", () => {
    const now = new Date("2026-07-13T14:00:00Z");
    const start5m = new Date(computeStartDate(now, "5m", 100));
    const startDaily = new Date(computeStartDate(now, "1d", 30));
    expect(startDaily.getTime()).toBeLessThan(start5m.getTime());
  });

  it("is deterministic for the same inputs", () => {
    const now = new Date("2026-07-13T14:00:00Z");
    expect(computeStartDate(now, "5m", 100)).toBe(computeStartDate(now, "5m", 100));
  });
});

describe("mapAlpacaBar", () => {
  it("maps an Alpaca bar to our Candle shape", () => {
    const bar = {
      t: "2026-07-11T14:30:00Z",
      o: 100.1,
      h: 101.2,
      l: 99.8,
      c: 100.9,
      v: 125000,
    };
    const candle = mapAlpacaBar(bar);
    expect(candle.open).toBe(100.1);
    expect(candle.high).toBe(101.2);
    expect(candle.low).toBe(99.8);
    expect(candle.close).toBe(100.9);
    expect(candle.volume).toBe(125000);
    expect(candle.time).toBe(Math.floor(new Date(bar.t).getTime() / 1000));
  });
});

describe("AlpacaProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws if constructed without credentials", () => {
    expect(() => new AlpacaProvider({ apiKeyId: "", apiSecretKey: "" })).toThrow();
  });

  it("fetches and maps candles on a successful response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        bars: [
          { t: "2026-07-11T14:30:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
          { t: "2026-07-11T14:35:00Z", o: 100.5, h: 102, l: 100, c: 101.5, v: 1200 },
        ],
        symbol: "AAPL",
        next_page_token: null,
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    const series = await provider.getCandles({ symbol: "AAPL", timeframe: "5m", limit: 2 });

    expect(series.candles.length).toBe(2);
    expect(series.candles[0].close).toBe(100.5);
    expect(series.quality).toBe("realtime"); // iex feed, free tier => realtime per our quality mapping
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Regression check for the "no start param → empty response on
    // weekends/holidays" bug found against the live API.
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("start=");
  });

  it("throws a clear error on 401", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "bad", apiSecretKey: "bad" });
    await expect(provider.getCandles({ symbol: "AAPL", timeframe: "5m" })).rejects.toThrow(
      /authentication failed/i
    );
  });

  it("keeps the most recent candles, not the oldest, when the API returns more than requested", async () => {
    // Simulate Alpaca returning far more bars than the caller's `limit`
    // within the lookback window — exactly the real-world scenario that
    // caused stale candles before this was fixed.
    const manyBars = Array.from({ length: 10 }, (_, i) => ({
      t: `2026-07-13T${String(10 + i).padStart(2, "0")}:00:00Z`,
      o: 100 + i,
      h: 101 + i,
      l: 99 + i,
      c: 100.5 + i,
      v: 1000,
    }));
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ bars: manyBars, symbol: "AAPL", next_page_token: null }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    const series = await provider.getCandles({ symbol: "AAPL", timeframe: "5m", limit: 3 });

    expect(series.candles.length).toBe(3);
    // Should be the LAST 3 (most recent), i.e. closes 107.5, 108.5, 109.5 -
    // not the first 3 (100.5, 101.5, 102.5).
    expect(series.candles.map((c) => c.close)).toEqual([107.5, 108.5, 109.5]);
  });

  it("requests a fetch limit larger than the caller's limit to cover the lookback window", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ bars: [], symbol: "AAPL", next_page_token: null }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    await provider.getCandles({ symbol: "AAPL", timeframe: "5m", limit: 100 });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const requestedLimit = Number(new URL(calledUrl).searchParams.get("limit"));
    expect(requestedLimit).toBeGreaterThan(100);
  });

  it("serves cached results without a second fetch call", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        bars: [{ t: "2026-07-11T14:30:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1000 }],
        symbol: "AAPL",
        next_page_token: null,
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    await provider.getCandles({ symbol: "AAPL", timeframe: "5m", limit: 1 });
    await provider.getCandles({ symbol: "AAPL", timeframe: "5m", limit: 1 });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
