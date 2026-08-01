import type {
  Candle,
  CandleSeries,
  DataQuality,
  PaginationStatus,
  Timeframe,
} from "@/types/candle";
import { DEFAULT_BAR_ADJUSTMENT } from "../types";
import type {
  GetCandlesParams,
  MarketDataProvider,
  ProviderFeedInfo,
  SessionInfo,
} from "../types";
import { computeSessionInfo } from "../session";
import { RateLimiter } from "../rateLimiter";
import { TtlCache, CANDLE_CACHE_TTL_MS } from "../cache";
import { filterToLatestSession, filterToRecentSessions } from "../sessionFilter";

const ALPACA_DATA_BASE_URL = "https://data.alpaca.markets/v2";

/** Alpaca's hard per-page bar ceiling. */
export const ALPACA_MAX_BARS_PER_PAGE = 10_000;

/**
 * Default ceiling on `next_page_token` follows for a single getCandles
 * call. Four pages covers ~40,000 bars — comfortably more than 21 sessions
 * of extended-hours 1-minute data — while bounding the worst case if the
 * provider ever returns a non-terminating token chain.
 *
 * Deliberately kept as a DEFENSIVE bound rather than raised whenever a
 * response is truncated: a request that does not fit inside it is a
 * request that has been sized wrong, and `requestFitsWithinPageCap` exists
 * so that is visible up front instead of showing up as missing recent
 * sessions. Configurable per provider instance.
 */
export const DEFAULT_MAX_BAR_PAGES = 4;

/** How many pages a bar budget needs at Alpaca's per-page cap. */
export function estimatePagesRequired(
  barCount: number,
  barsPerPage: number = ALPACA_MAX_BARS_PER_PAGE
): number {
  if (!Number.isFinite(barCount) || barCount <= 0) return 1;
  return Math.max(1, Math.ceil(barCount / barsPerPage));
}

/** Whether an intended request can be served without hitting the page cap. */
export function requestFitsWithinPageCap(
  barCount: number,
  maxPages: number = DEFAULT_MAX_BAR_PAGES,
  barsPerPage: number = ALPACA_MAX_BARS_PER_PAGE
): boolean {
  return estimatePagesRequired(barCount, barsPerPage) <= maxPages;
}

const TIMEFRAME_TO_ALPACA: Record<Timeframe, string> = {
  "1m": "1Min",
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
function lookbackDays(timeframe: Timeframe, limit: number, sessionCount: number): number {
  if (timeframe === "1d") {
    // Roughly 5 trading days per 7 calendar days, plus a buffer for holidays.
    return Math.ceil(limit * 1.6) + 10;
  }
  if (timeframe === "1m") {
    // 1m is the only timeframe whose historical baselines reach back many
    // SESSIONS (20 by default, for the dollar-volume and true-range
    // time-of-day medians), so the flat 6-day window below is nowhere near
    // enough — 6 calendar days is ~4 sessions.
    //
    // Sized from `sessionCount` ALONE, deliberately. The bar limit used to
    // participate via `ceil(limit / 390)`, but a caller's bar budget is an
    // upper bound on BARS, not a statement about calendar span: the
    // historical cache asks for 960 bars per session (16 extended hours),
    // and dividing that by a 390-bar regular session inflated a 21-session
    // request into ~52 sessions and an ~89-day window. Alpaca paginates
    // oldest-first, so the extra breadth pushed the response past the page
    // cap and dropped the NEWEST sessions, today included, while still
    // looking like a complete answer.
    //
    // ~5 trading days per 7 calendar days means 1.4 calendar days per
    // session; 1.6 is the conservative form, and the flat buffer covers
    // holiday clusters (no market-holiday calendar exists here yet — see
    // session.ts). The buffer matches the 6-day floor the other intraday
    // timeframes use for a single session.
    return Math.ceil(Math.max(1, sessionCount) * 1.6) + 6;
  }
  // Intraday (5m/15m): a handful of calendar days comfortably reaches
  // back across any weekend, even a 3-day holiday weekend.
  if (sessionCount <= 1) return 6;
  // ...but an explicit multi-session request (a historical baseline) has
  // to widen the same way 1m does, or the window silently caps the
  // baseline at whatever ~4 sessions fit in 6 calendar days. Deliberately
  // left as a separate branch so the single-session default — every
  // existing caller — keeps the exact 6-day window it has today.
  return Math.ceil(sessionCount * 1.6) + 5;
}

/** Pure, testable: computes the ISO start timestamp for a given lookback window. */
export function computeStartDate(
  now: Date,
  timeframe: Timeframe,
  limit: number,
  sessionCount: number = 1
): string {
  const days = lookbackDays(timeframe, limit, sessionCount);
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
    private requestTimeoutMs: number = 10_000,
    /**
     * Defensive ceiling on page follows. Configurable so a test can prove
     * the cap is reported rather than hidden, and so an operator can raise
     * it deliberately — not so truncation can be papered over.
     */
    private maxBarPages: number = DEFAULT_MAX_BAR_PAGES
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
   * The feed's own delay characteristics, stated once here rather than
   * re-derived by each consumer.
   *
   * IEX is free real-time (single exchange); SIP is the full consolidated
   * tape, real-time on a paid plan and 15-minute delayed on the free one.
   * The delay is BOUNDED and known, which is what lets a delayed feed
   * still clear the expansion alert gate — an unknown-delay feed could
   * not.
   */
  feedInfo(): ProviderFeedInfo {
    const feed = this.config.feed ?? "iex";
    const delayed = this.dataQuality() === "delayed";
    return { feed, delayed, knownDelayMinutes: delayed ? 15 : null };
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
    const {
      symbol,
      timeframe,
      limit = 100,
      deadlineAt,
      sessionScope = "regular",
      sessionCount = 1,
      adjustment = DEFAULT_BAR_ADJUSTMENT,
    } = params;
    const quality = this.dataQuality();
    // sessionScope and sessionCount MUST both be part of the key: the same
    // symbol/timeframe/limit yields a different candle set per scope, so
    // omitting scope would serve regular-hours bars to a premarket request
    // (or vice versa) from cache — and omitting sessionCount would serve a
    // single collapsed session to a 20-session baseline request, which
    // fails silently as "only 1 eligible session" rather than as an error.
    //
    // The feed and adjustment mode belong here for the same reason: IEX and
    // SIP return different premarket coverage, and raw and adjusted bars are
    // different prices for the same session.
    const feed = this.config.feed ?? "iex";
    const cacheKey = `${feed}:${adjustment}:${symbol}:${timeframe}:${limit}:${sessionScope}:${sessionCount}`;

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
    const fetchLimit = Math.min(Math.max(limit * 5, 500), ALPACA_MAX_BARS_PER_PAGE);

    const url = new URL(`${ALPACA_DATA_BASE_URL}/stocks/${symbol}/bars`);
    url.searchParams.set("timeframe", alpacaTimeframe);
    url.searchParams.set("limit", String(fetchLimit));
    url.searchParams.set("feed", feed);
    url.searchParams.set("adjustment", adjustment);
    url.searchParams.set("start", computeStartDate(new Date(), timeframe, limit, sessionCount));

    // Pagination: `next_page_token` was declared on the response type but
    // never followed, which silently truncated any window larger than one
    // page. Harmless at 5m/15m (a few hundred bars), but 20 sessions of
    // 1-minute bars is ~14,000 — well past Alpaca's 10,000-per-page cap,
    // so the tail was being dropped without any error. Pages are capped so
    // a runaway token loop can't consume the whole request budget.
    //
    // The cap is reported, not hidden. Alpaca paginates OLDEST-FIRST, so
    // stopping early loses the NEWEST bars — today's session included —
    // while the array that comes back looks entirely ordinary. A result is
    // complete only when the chain ended with no token left.
    const rawBars: AlpacaBar[] = [];
    let pageToken: string | null = null;
    let pagesFetched = 0;

    do {
      if (pageToken) url.searchParams.set("page_token", pageToken);

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
      if (data.bars) rawBars.push(...data.bars);

      pageToken = data.next_page_token ?? null;
      pagesFetched += 1;
    } while (pageToken && pagesFetched < this.maxBarPages);

    const nextPageTokenRemaining = pageToken !== null;
    const pagination: PaginationStatus = {
      complete: !nextPageTokenRemaining,
      pagesFetched,
      nextPageTokenRemaining,
      // Deadline exhaustion and provider errors abort the whole call by
      // throwing, so the only truncation that can reach here is the cap.
      truncationReason: nextPageTokenRemaining ? "page_cap_reached" : null,
    };

    const allCandles = rawBars.map(mapAlpacaBar);

    // FIX (Codex review): session contamination. Daily candles are
    // already one-per-session by definition, so filtering doesn't apply
    // to them - but for 5m/15m, a candle array spanning a multi-day
    // lookback window must be trimmed down to a SINGLE session before
    // slicing to `limit`, or session-scoped calculations (VWAP, session
    // high/low, decline-from-open) silently mix days together. See
    // filterToLatestSession()'s own comment for the full reasoning.
    //
    // A caller asking for more than one session (a historical baseline)
    // gets the most recent `sessionCount` sessions concatenated in
    // chronological order instead — same scope filter, same day-bucketing,
    // just without discarding everything but the last group.
    const sessionScoped =
      timeframe === "1d"
        ? allCandles
        : sessionCount > 1
        ? filterToRecentSessions(allCandles, sessionCount, sessionScope).flatMap((g) => g.candles)
        : filterToLatestSession(allCandles, sessionScope);

    // Bars come back chronologically ascending, so the most recent ones
    // are at the end — keep only however many the caller actually asked
    // for, from within the correctly session-scoped set.
    const candles = sessionScoped.slice(-limit);

    const series: CandleSeries = { symbol, timeframe, quality, candles, pagination };
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
