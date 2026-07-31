import type { Candle, CandleSeries, DataQuality, Timeframe } from "@/types/candle";
import type { GetCandlesParams, MarketDataProvider, SessionInfo } from "../types";
import { computeSessionInfo } from "../session";
import { RateLimiter } from "../rateLimiter";
import { TtlCache, CANDLE_CACHE_TTL_MS } from "../cache";
import { filterToLatestSession } from "../sessionFilter";

const ALPACA_DATA_BASE_URL = "https://data.alpaca.markets/v2";

const TIMEFRAME_TO_ALPACA: Record<Timeframe, string> = {
  "5m": "5Min",
  "15m": "15Min",
  "1d": "1Day",
};

interface AlpacaBar {
  t: string; // RFC-3339 timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface AlpacaBarsResponse {
  bars: AlpacaBar[] | null;
  symbol: string;
  next_page_token: string | null;
}

/** Pure mapper — no network involved, fully unit-testable. */
export function mapAlpacaBar(bar: AlpacaBar): Candle {
  return {
    time: Math.floor(new Date(bar.t).getTime() / 1000),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  };
}

export interface AlpacaProviderConfig {
  apiKeyId: string;
  apiSecretKey: string;
  /**
   * "iex" = free real-time (single-exchange) feed. "sip" = full
   * consolidated tape; real-time on paid plans, 15-minute delayed on the
   * free plan. Defaults to "iex" since that's what a free-tier key
   * actually has access to for real-time data.
   */
  feed?: "iex" | "sip";
  isPaidPlan?: boolean;
}

/**
 * How many calendar days back to request, per timeframe. Generous enough
 * to guarantee crossing at least one real trading session even across a
 * long weekend or a holiday cluster (we don't have a real market-holiday
 * calendar yet — see the limitation noted in session.ts — so this errs on
 * the side of "too many calendar days" rather than risking an empty
 * response again).
 */
function lookbackDays(timeframe: Timeframe, limit: number): number {
  if (timeframe === "1d") {
    // Roughly 5 trading days per 7 calendar days, plus a buffer for holidays.
    return Math.ceil(limit * 1.6) + 10;
  }
  // Intraday (5m/15m): a handful of calendar days comfortably reaches
  // back across any weekend, even a 3-day holiday weekend.
  return 6;
}

/** Pure, testable: computes the ISO start timestamp for a given lookback window. */
export function computeStartDate(now: Date, timeframe: Timeframe, limit: number): string {
  const days = lookbackDays(timeframe, limit);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return start.toISOString();
}

/**
 * A single retry wait should never exceed this, regardless of what a
 * Retry-After header requests. FIX (Codex round 5): a Retry-After of 60
 * (or higher) would previously be honored literally, which could consume
 * the ENTIRE 60-second budget of the cron route's serverless function in
 * one wait — and since symbols are scanned sequentially, that could
 * prevent every later symbol (and every other user, in the cron route)
 * from being processed at all. 5 seconds is a reasonable ceiling for a
 * background scan that needs to stay responsive across many symbols.
 */
export const MAX_RETRY_DELAY_MS = 5_000;

/**
 * Parses a Retry-After header value per HTTP spec, which permits EITHER
 * a number of seconds OR an HTTP-date (e.g. "Wed, 21 Oct 2015 07:28:00
 * GMT"). FIX (Codex round 5): the previous version only handled the
 * numeric form — a date-form header silently fell through to exponential
 * backoff instead of being honored. Returns milliseconds until the
 * requested time, or null if the header is absent/unparseable/already in
 * the past (callers should fall back to exponential backoff in that case).
 */
export function parseRetryAfterMs(retryAfterHeader: string | null, now: number = Date.now()): number | null {
  if (retryAfterHeader === null) return null;

  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds)) {
    // The header parsed as SOME number, so it was clearly intended as
    // the numeric delta-seconds form, not an HTTP-date. A negative value
    // is invalid — return null rather than falling through to
    // Date.parse(), which is notoriously lenient and can accept a
    // numeric-looking string as a bogus (very old) valid date instead of
    // NaN (e.g. Date.parse("-5") does NOT return NaN), silently
    // misclassifying an invalid numeric value as a valid HTTP-date.
    return seconds >= 0 ? seconds * 1000 : null;
  }

  const dateMs = Date.parse(retryAfterHeader);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - now;
    return delta > 0 ? delta : 0;
  }

  return null;
}

/**
 * Computes how long to wait before the next retry attempt. Prefers the
 * server's own Retry-After guidance (seconds or HTTP-date, per HTTP spec)
 * when present and parseable; otherwise falls back to exponential backoff
 * (300ms, 600ms, 1200ms, ...). Always capped at MAX_RETRY_DELAY_MS,
 * regardless of source — a server-requested delay is guidance, not a
 * license to stall a bounded-execution caller indefinitely. Extracted as
 * its own pure function so this decision can be tested directly and
 * instantly, without any real (or fake-timer) waiting.
 */
export function computeRetryDelayMs(
  attempt: number,
  retryAfterHeader: string | null,
  now: number = Date.now()
): number {
  const parsed = parseRetryAfterMs(retryAfterHeader, now);
  const rawDelay = parsed !== null ? parsed : 300 * Math.pow(2, attempt);
  return Math.min(rawDelay, MAX_RETRY_DELAY_MS);
}

/**
 * Small positive buffer subtracted from the remaining deadline when
 * computing both "is there any time left at all" and "how long should
 * this attempt's own timeout be" — leaves room for response parsing and
 * caller cleanup after a fetch resolves, so a request that technically
 * finishes right at the deadline doesn't still blow the overall budget
 * by the time its response body is read.
 */
const DEADLINE_SAFETY_MARGIN_MS = 500;

export class AlpacaProvider implements MarketDataProvider {
  name = "alpaca";

  private rateLimiter: RateLimiter;
  private cache = new TtlCache<CandleSeries>(CANDLE_CACHE_TTL_MS["5m"]);

  constructor(
    private config: AlpacaProviderConfig,
    /**
     * Optional injected rate limiter — for tests only, so a test can
     * assert on real consumed capacity (via RateLimiter.remaining())
     * after a retry sequence, rather than only inferring accounting
     * correctness indirectly from fetch call counts (which would still
     * pass even if recordRequest() were accidentally removed).
     */
    rateLimiter?: RateLimiter,
    /**
     * Per-attempt request timeout ceiling — defaults to 10s in
     * production. Test-only override, so deadline-related tests can use
     * a tiny value (e.g. 50ms) and assert on abort behavior almost
     * instantly instead of needing real multi-second waits.
     */
    private requestTimeoutMs: number = 10_000
  ) {
    if (!config.apiKeyId || !config.apiSecretKey) {
      throw new Error(
        "AlpacaProvider requires apiKeyId and apiSecretKey. Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in your server environment."
      );
    }
    // Free tier: 200 requests/minute. Paid (Algo Trader Plus): 10,000/min.
    const maxRequests = config.isPaidPlan ? 10_000 : 200;
    this.rateLimiter = rateLimiter ?? new RateLimiter(maxRequests, 60_000);
  }

  private dataQuality(): DataQuality {
    const feed = this.config.feed ?? "iex";
    if (this.config.isPaidPlan) return "realtime";
    return feed === "iex" ? "realtime" : "delayed";
  }

  /**
   * How long this specific attempt's own AbortController timeout should
   * be — the smaller of the normal per-attempt ceiling (requestTimeoutMs)
   * and whatever time is actually left before the deadline (minus the
   * safety margin). Without this, a fetch could still run for the full
   * 10s ceiling even with almost no deadline budget remaining, blowing
   * through it by however much longer the fetch took than the budget
   * allowed.
   */
  private computeAttemptTimeoutMs(deadlineAt: number | undefined): number {
    if (deadlineAt === undefined) return this.requestTimeoutMs;
    const remaining = deadlineAt - Date.now() - DEADLINE_SAFETY_MARGIN_MS;
    return Math.max(0, Math.min(this.requestTimeoutMs, remaining));
  }

  /**
   * Fetches with bounded retry for transient failures — 429 rate limit,
   * 5xx server errors, genuine network exceptions (DNS failure,
   * connection reset, timeout), and our own request timeout via
   * AbortController. Never retries 401/403 (auth is either right or it
   * isn't) or 4xx client errors other than 429 (a malformed request
   * fails the same way every time).
   *
   * FIX (Codex round 5, deadline-awareness): a capped Retry-After delay
   * (MAX_RETRY_DELAY_MS) alone doesn't prevent a bounded-execution caller
   * from being stalled — even a 5-second wait, repeated across a few
   * symbols in a sequential scan, could still eat meaningfully into the
   * cron route's 60-second budget. If a `deadlineAt` is provided and
   * honoring the computed delay would push past it, this fails fast with
   * a clear "not enough time remaining" error for just this symbol,
   * instead of waiting and risking the whole route timing out mid-scan.
   *
   * FIX (Codex round 6): round 5's deadline check only ran before RETRY
   * waits — the initial attempt of a symbol could still start after the
   * deadline had already effectively passed (if a prior symbol used up
   * the remaining budget), and every attempt's fetch still got the FULL
   * requestTimeoutMs regardless of how little time was actually left,
   * meaning a slow-but-not-technically-erroring fetch could still blow
   * through the deadline by many seconds even when the pre-wait check
   * correctly allowed the attempt to start. Now the deadline is checked
   * before EVERY attempt (not just before waits), and each attempt's own
   * abort timeout is capped at whatever time genuinely remains.
   */
  private async fetchWithRetry(
    url: string,
    deadlineAt: number | undefined,
    maxRetries = 2
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Fail immediately if the deadline has already passed (or is about
      // to, within the safety margin) — before spending any rate-limit
      // budget or starting a fetch that couldn't possibly finish in time.
      this.assertWithinDeadline(0, deadlineAt, url);

      if (!this.rateLimiter.canProceed()) {
        const waitMs = this.rateLimiter.msUntilNextSlot();
        throw new Error(
          `Alpaca rate limit reached. Try again in ${Math.ceil(waitMs / 1000)}s. ` +
            `Consider caching or reducing watchlist size.`
        );
      }
      this.rateLimiter.recordRequest();

      const attemptTimeoutMs = this.computeAttemptTimeoutMs(deadlineAt);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs);

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            "APCA-API-KEY-ID": this.config.apiKeyId,
            "APCA-API-SECRET-KEY": this.config.apiSecretKey,
          },
          signal: controller.signal,
        });
      } catch (err) {
        // Network failure or our own timeout abort - both transient,
        // both worth retrying, neither retried past maxRetries.
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === maxRetries) {
          throw new Error(
            `Alpaca request failed after ${maxRetries + 1} attempt(s): ${lastError.message}`
          );
        }
        const delay = computeRetryDelayMs(attempt, null);
        this.assertWithinDeadline(delay, deadlineAt, url);
        await this.wait(delay);
        continue;
      } finally {
        clearTimeout(timeoutId);
      }

      const isTransient = response.status === 429 || response.status >= 500;
      if (response.ok || !isTransient || attempt === maxRetries) {
        return response;
      }

      // Prefer the server's own Retry-After guidance over our fixed
      // backoff when it's present (optional chaining: test doubles for
      // Response often don't implement a real Headers object).
      const retryAfterHeader = response.headers?.get?.("Retry-After") ?? null;
      const delay = computeRetryDelayMs(attempt, retryAfterHeader);
      this.assertWithinDeadline(delay, deadlineAt, url);

      await this.wait(delay);
    }

    // Unreachable in practice (the loop always returns or throws on its
    // final iteration), but keeps TypeScript happy about a definite return.
    throw lastError ?? new Error("Alpaca request failed for an unknown reason.");
  }

  /** Throws a clear, distinct error if waiting `delayMs` would push past `deadlineAt` (with safety margin). */
  private assertWithinDeadline(delayMs: number, deadlineAt: number | undefined, url: string): void {
    if (deadlineAt === undefined) return;
    if (Date.now() + delayMs + DEADLINE_SAFETY_MARGIN_MS > deadlineAt) {
      throw new Error(
        `Alpaca request for ${url} would exceed the remaining execution deadline — ` +
          `failing fast instead of risking the whole scan timing out. Try again later.`
      );
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getCandles(params: GetCandlesParams): Promise<CandleSeries> {
    const { symbol, timeframe, limit = 100, deadlineAt, sessionScope = "regular" } = params;
    const quality = this.dataQuality();
    // sessionScope MUST be part of the key: the same symbol/timeframe/limit
    // yields a different candle set per scope, so omitting it would serve
    // regular-hours bars to a premarket request (or vice versa) from cache.
    const cacheKey = `${symbol}:${timeframe}:${limit}:${sessionScope}`;

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const alpacaTimeframe = TIMEFRAME_TO_ALPACA[timeframe];

    // Real bug found in production: requesting `limit` directly from
    // Alpaca alongside a multi-day `start` window means Alpaca returns
    // the OLDEST `limit` bars within that window (paginating forward
    // from `start`), not the most recent ones — a 6-day intraday window
    // can contain 400+ possible 5-minute bars, so `limit=100` silently
    // returned days-stale candles instead of current ones. Fixed by
    // always requesting a generously oversized batch (comfortably more
    // than any realistic window could contain) and keeping only the
    // most recent `limit` candles ourselves before returning.
    const fetchLimit = Math.min(Math.max(limit * 5, 500), 10_000);

    const url = new URL(`${ALPACA_DATA_BASE_URL}/stocks/${symbol}/bars`);
    url.searchParams.set("timeframe", alpacaTimeframe);
    url.searchParams.set("limit", String(fetchLimit));
    url.searchParams.set("feed", this.config.feed ?? "iex");
    url.searchParams.set("adjustment", "raw");
    url.searchParams.set("start", computeStartDate(new Date(), timeframe, limit));

    const response = await this.fetchWithRetry(url.toString(), deadlineAt);

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Alpaca returned 429 Too Many Requests — rate limit exceeded upstream.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error("Alpaca authentication failed — check ALPACA_API_KEY_ID/SECRET.");
      }
      throw new Error(`Alpaca request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as AlpacaBarsResponse;
    const allCandles = (data.bars ?? []).map(mapAlpacaBar);

    // FIX (Codex review): session contamination. Daily candles are
    // already one-per-session by definition, so filtering doesn't apply
    // to them - but for 5m/15m, a candle array spanning a multi-day
    // lookback window must be trimmed down to a SINGLE session before
    // slicing to `limit`, or session-scoped calculations (VWAP, session
    // high/low, decline-from-open) silently mix days together. See
    // filterToLatestSession()'s own comment for the full reasoning.
    const sessionScoped =
      timeframe === "1d" ? allCandles : filterToLatestSession(allCandles, sessionScope);

    // Bars come back chronologically ascending, so the most recent ones
    // are at the end — keep only however many the caller actually asked
    // for, from within the correctly session-scoped set.
    const candles = sessionScoped.slice(-limit);

    const series: CandleSeries = { symbol, timeframe, quality, candles };
    this.cache.set(cacheKey, series, CANDLE_CACHE_TTL_MS[timeframe]);
    return series;
  }

  async getSessionInfo(): Promise<SessionInfo> {
    // V1: computed locally rather than calling Alpaca's /clock endpoint,
    // to avoid spending a rate-limited request on something we can derive.
    // Swap to the real /v2/clock endpoint later if a holiday calendar
    // becomes necessary — see the limitation noted in session.ts.
    return computeSessionInfo();
  }
}
