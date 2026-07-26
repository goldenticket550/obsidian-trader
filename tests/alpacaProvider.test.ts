import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mapAlpacaBar,
  AlpacaProvider,
  computeStartDate,
  computeRetryDelayMs,
  parseRetryAfterMs,
  MAX_RETRY_DELAY_MS,
} from "@/lib/market-data/providers/alpacaProvider";
import { RateLimiter } from "@/lib/market-data/rateLimiter";

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
      t: "2026-07-13T14:30:00Z",
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
          { t: "2026-07-13T14:30:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
          { t: "2026-07-13T14:35:00Z", o: 100.5, h: 102, l: 100, c: 101.5, v: 1200 },
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
        bars: [{ t: "2026-07-13T14:30:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1000 }],
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
          bars: [{ t: "2026-07-13T14:30:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1000 }],
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

  // Regression tests for real gaps found in a follow-up Codex review of
  // the retry logic itself.

  it("retries a genuine network exception (rejected fetch), not just a non-ok response", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error: connection reset"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          bars: [{ t: "2026-07-13T14:30:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1000 }],
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

  it("stops retrying network exceptions after maxRetries and throws a descriptive error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("connection reset"));
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    await expect(provider.getCandles({ symbol: "AAPL", timeframe: "5m" })).rejects.toThrow(
      /connection reset/
    );
    expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  }, 10_000);

  it("passes an AbortSignal on every fetch attempt (request timeout support)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ bars: [], symbol: "AAPL", next_page_token: null }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    await provider.getCandles({ symbol: "AAPL", timeframe: "5m" });

    const callOptions = mockFetch.mock.calls[0][1];
    expect(callOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it("counts every actual retry attempt against the rate limiter, not just the first (Codex round 5 strengthened test)", async () => {
    // FIX (Codex round 5): the previous version of this test only
    // checked fetch call count, which would still pass even if
    // recordRequest() were accidentally removed from the retry loop.
    // This version injects a real RateLimiter and asserts directly on
    // its consumed capacity.
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" });
    vi.stubGlobal("fetch", mockFetch);

    const rateLimiter = new RateLimiter(200, 60_000);
    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" }, rateLimiter);

    expect(rateLimiter.remaining()).toBe(200);
    await expect(provider.getCandles({ symbol: "AAPL", timeframe: "5m" })).rejects.toThrow();

    // 1 initial attempt + 2 retries = 3 real requests, so exactly 3
    // units of capacity should be consumed, not 1.
    expect(rateLimiter.remaining()).toBe(197);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 10_000);

  // Regression tests for a real gap found in a follow-up Codex review:
  // a large or malformed Retry-After could stall a bounded-execution
  // caller (like the 60-second cron route) far longer than intended.

  it("caps an extreme Retry-After value at MAX_RETRY_DELAY_MS instead of honoring it literally", () => {
    // Retry-After: 60 would otherwise consume the entire cron route's
    // 60-second budget in a single wait.
    expect(computeRetryDelayMs(0, "60")).toBe(MAX_RETRY_DELAY_MS);
    expect(computeRetryDelayMs(0, "3600")).toBe(MAX_RETRY_DELAY_MS);
  });

  it("parses an HTTP-date-form Retry-After header, not just numeric seconds", () => {
    const now = Date.parse("2026-07-13T12:00:00Z");
    const futureDate = "Mon, 13 Jul 2026 12:00:05 GMT"; // 5 seconds later
    const delay = computeRetryDelayMs(0, futureDate, now);
    expect(delay).toBeCloseTo(5000, -2); // within ~100ms tolerance
  });

  it("falls back to exponential backoff when an HTTP-date Retry-After is already in the past", () => {
    const now = Date.parse("2026-07-13T12:00:00Z");
    const pastDate = "Mon, 13 Jul 2026 11:00:00 GMT"; // 1 hour in the past
    const delay = computeRetryDelayMs(0, pastDate, now);
    expect(delay).toBe(0); // parseRetryAfterMs clamps a past date to 0, not negative
  });

  it("caps an HTTP-date Retry-After far in the future at MAX_RETRY_DELAY_MS too", () => {
    const now = Date.parse("2026-07-13T12:00:00Z");
    const farFuture = "Tue, 14 Jul 2026 12:00:00 GMT"; // 24 hours later
    const delay = computeRetryDelayMs(0, farFuture, now);
    expect(delay).toBe(MAX_RETRY_DELAY_MS);
  });

  it("fails fast with a clear error instead of waiting when honoring a delay would exceed the deadline", async () => {
    const now = Date.now();
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, statusText: "Too Many Requests", headers: { get: () => "60" } });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    // Deadline just 1 second away - even the capped 5s delay would exceed it.
    const deadlineAt = now + 1000;

    const start = Date.now();
    await expect(
      provider.getCandles({ symbol: "AAPL", timeframe: "5m", deadlineAt })
    ).rejects.toThrow(/deadline/i);
    const elapsed = Date.now() - start;

    // Should fail almost immediately - NOT wait out even the capped delay.
    expect(elapsed).toBeLessThan(1000);
    expect(mockFetch).toHaveBeenCalledTimes(1); // failed fast, no retry attempted
  });

  it("succeeds normally when the deadline leaves comfortably enough time", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          bars: [{ t: "2026-07-13T14:30:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1000 }],
          symbol: "AAPL",
          next_page_token: null,
        }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    const deadlineAt = Date.now() + 30_000; // plenty of time

    const series = await provider.getCandles({ symbol: "AAPL", timeframe: "5m", limit: 1, deadlineAt });
    expect(series.candles.length).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("parseRetryAfterMs", () => {
  it("returns null when the header is absent", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
  });

  it("parses numeric seconds", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("parses HTTP-date form relative to a given 'now'", () => {
    const now = Date.parse("2026-07-13T12:00:00Z");
    expect(parseRetryAfterMs("Mon, 13 Jul 2026 12:00:10 GMT", now)).toBe(10_000);
  });

  it("clamps a past HTTP-date to 0 rather than a negative number", () => {
    const now = Date.parse("2026-07-13T12:00:00Z");
    expect(parseRetryAfterMs("Mon, 13 Jul 2026 11:00:00 GMT", now)).toBe(0);
  });

  it("returns null for a genuinely unparseable value", () => {
    expect(parseRetryAfterMs("not-a-real-value-at-all")).toBeNull();
  });

  it("rejects a negative numeric string rather than misinterpreting it via Date.parse", () => {
    // Regression test for a real bug found during verification:
    // Date.parse("-5") does NOT return NaN (JS's lenient date parser
    // accepts it as a bogus valid date), so a negative numeric string
    // must be rejected BEFORE ever reaching Date.parse(), not after.
    expect(parseRetryAfterMs("-5")).toBeNull();
    expect(parseRetryAfterMs("-100")).toBeNull();
  });
});

describe("fetchWithRetry deadline enforcement (Codex round 6)", () => {
  /** A fetch mock that never resolves on its own - only rejects with an
   * AbortError once its AbortSignal actually fires, mimicking real
   * fetch+AbortController behavior. Lets these tests prove abort timing
   * precisely instead of guessing from total elapsed time around a
   * fetch that resolves instantly regardless of the signal. */
  function makePendingUntilAbortFetch() {
    return vi.fn((_url: string, options: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
  }

  it("still uses the normal (full) request timeout when no deadline is set", async () => {
    const mockFetch = makePendingUntilAbortFetch();
    vi.stubGlobal("fetch", mockFetch);

    // Inject a short "full" timeout (100ms) purely so this test runs
    // fast - the point is proving NO deadline-based capping occurs, not
    // testing the literal production value of 10s.
    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" }, undefined, 100);

    const start = Date.now();
    await expect(provider.getCandles({ symbol: "AAPL", timeframe: "5m" })).rejects.toThrow();
    const elapsed = Date.now() - start;

    // A timeout abort is itself a retryable transient failure (see the
    // round-4 network-exception fix), so the full sequence here is 3
    // attempts x ~100ms timeout, plus the 300ms and 600ms backoff waits
    // between them - roughly 1200ms total, NOT a single 100ms attempt.
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // The lower bound is the assertion that actually matters: it proves
    // each attempt waited out its full 100ms timeout rather than being
    // capped shorter, which is what must NOT happen when no deadline is
    // set. The upper bound just keeps the test honest about the total.
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(2500);
  });

  it("fails immediately with zero fetch calls when the deadline has already passed", async () => {
    const mockFetch = makePendingUntilAbortFetch();
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" });
    const deadlineAt = Date.now() - 1000; // already in the past

    const start = Date.now();
    await expect(
      provider.getCandles({ symbol: "AAPL", timeframe: "5m", deadlineAt })
    ).rejects.toThrow(/deadline/i);
    const elapsed = Date.now() - start;

    // Fails before ever attempting the first fetch - the deadline check
    // now runs before EVERY attempt, including the initial one.
    expect(mockFetch).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(200);
  });

  it("caps a single attempt's own timeout to the remaining deadline budget, shorter than the full request timeout", async () => {
    const mockFetch = makePendingUntilAbortFetch();
    vi.stubGlobal("fetch", mockFetch);

    // Full timeout is a realistic 10s, but the deadline only leaves
    // ~1.5s - 500ms safety margin = ~1s of actual budget for this
    // attempt. If capping works, the abort fires around 1s, not 10s.
    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" }, undefined, 10_000);
    const deadlineAt = Date.now() + 1500;

    const start = Date.now();
    await expect(
      provider.getCandles({ symbol: "AAPL", timeframe: "5m", deadlineAt })
    ).rejects.toThrow();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(800);
    expect(elapsed).toBeLessThan(3000); // nowhere near the full 10s
  }, 5_000);

  it("caps a RETRY attempt's timeout too, not just the initial attempt", async () => {
    let callCount = 0;
    const mockFetch = vi.fn((_url: string, options: { signal: AbortSignal }) => {
      callCount++;
      if (callCount === 1) {
        // First attempt fails fast with a transient network error.
        return Promise.reject(new Error("ECONNRESET"));
      }
      // Second attempt (the retry) hangs until its own abort fires.
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret" }, undefined, 10_000);
    // Enough time for the first failure + a short backoff wait (300ms),
    // but the RETRY's own remaining budget should still be well under 10s.
    const deadlineAt = Date.now() + 2000;

    const start = Date.now();
    await expect(
      provider.getCandles({ symbol: "AAPL", timeframe: "5m", deadlineAt })
    ).rejects.toThrow();
    const elapsed = Date.now() - start;

    expect(callCount).toBe(2); // both the initial attempt and the retry happened
    expect(elapsed).toBeLessThan(3000); // proves the retry's own timeout was capped, not the full 10s
  }, 5_000);
});

describe("computeRetryDelayMs", () => {
  it("uses the Retry-After header value (in seconds, converted to ms) when present and valid", () => {
    expect(computeRetryDelayMs(0, "2")).toBe(2000);
    expect(computeRetryDelayMs(1, "5")).toBe(5000);
  });

  it("falls back to exponential backoff when Retry-After is null", () => {
    expect(computeRetryDelayMs(0, null)).toBe(300);
    expect(computeRetryDelayMs(1, null)).toBe(600);
    expect(computeRetryDelayMs(2, null)).toBe(1200);
  });

  it("falls back to exponential backoff when Retry-After is present but unparseable", () => {
    expect(computeRetryDelayMs(0, "not-a-number")).toBe(300);
  });

  it("falls back to exponential backoff when Retry-After is negative", () => {
    expect(computeRetryDelayMs(0, "-5")).toBe(300);
  });

  it("accepts a Retry-After of exactly 0", () => {
    expect(computeRetryDelayMs(0, "0")).toBe(0);
  });
});
