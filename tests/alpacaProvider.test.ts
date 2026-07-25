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

  // Regression tests for a real bug (Codex review): one transient
  // failure used to immediately throw with no retry, which — combined
  // with the lack of per-symbol isolation in scanWatchlistWithProvider —
  // meant a single bad request could take down an entire scan.

  it("retries a 500 error and succeeds on the second attempt", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" })
      .mockResolvedValueOnce({
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
    const series = await provider.getCandles({ symbol: "AAPL", timeframe: "5m", limit: 1 });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(series.candles.length).toBe(1);
  });

  it("retries a 429 up to the max, then throws if it never succeeds", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: "Too Many Requests" });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    await expect(provider.getCandles({ symbol: "AAPL", timeframe: "5m" })).rejects.toThrow(/429/);

    // Default maxRetries=2 means 3 total attempts (1 initial + 2 retries).
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("never retries a 401 - auth failures fail immediately", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "bad", apiSecretKey: "bad" });
    await expect(provider.getCandles({ symbol: "AAPL", timeframe: "5m" })).rejects.toThrow(
      /authentication failed/i
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("never retries a 400 - client errors other than 429 fail immediately", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: "Bad Request" });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    await expect(provider.getCandles({ symbol: "AAPL", timeframe: "5m" })).rejects.toThrow(/400/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("filters results to only the latest session before slicing to the requested limit", async () => {
    // Two distinct trading days present in the raw response - only the
    // later day's bars should survive in the final result.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        bars: [
          { t: "2026-07-10T14:00:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1000 }, // Friday
          { t: "2026-07-10T14:05:00Z", o: 100.5, h: 101, l: 99, c: 100.7, v: 1000 }, // Friday
          { t: "2026-07-13T14:00:00Z", o: 200, h: 201, l: 199, c: 200.5, v: 1000 }, // Monday
        ],
        symbol: "AAPL",
        next_page_token: null,
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    const series = await provider.getCandles({ symbol: "AAPL", timeframe: "5m", limit: 100 });

    expect(series.candles.length).toBe(1);
    expect(series.candles[0].close).toBe(200.5);
  });

  it("does NOT session-filter daily (1d) candles - each daily bar is already its own session", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        bars: [
          { t: "2026-07-10T14:00:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
          { t: "2026-07-13T14:00:00Z", o: 200, h: 201, l: 199, c: 200.5, v: 1000 },
        ],
        symbol: "AAPL",
        next_page_token: null,
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    const series = await provider.getCandles({ symbol: "AAPL", timeframe: "1d", limit: 100 });

    expect(series.candles.length).toBe(2); // both days kept, unlike intraday
  });
});
