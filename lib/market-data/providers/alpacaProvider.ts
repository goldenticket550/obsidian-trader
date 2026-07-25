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

export class AlpacaProvider implements MarketDataProvider {
  name = "alpaca";

  private rateLimiter: RateLimiter;
  private cache = new TtlCache<CandleSeries>(CANDLE_CACHE_TTL_MS["5m"]);

  constructor(private config: AlpacaProviderConfig) {
    if (!config.apiKeyId || !config.apiSecretKey) {
      throw new Error(
        "AlpacaProvider requires apiKeyId and apiSecretKey. Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in your server environment."
      );
    }
    // Free tier: 200 requests/minute. Paid (Algo Trader Plus): 10,000/min.
    const maxRequests = config.isPaidPlan ? 10_000 : 200;
    this.rateLimiter = new RateLimiter(maxRequests, 60_000);
  }

  private dataQuality(): DataQuality {
    const feed = this.config.feed ?? "iex";
    if (this.config.isPaidPlan) return "realtime";
    return feed === "iex" ? "realtime" : "delayed";
  }

  /**
   * Fetches with bounded retry for transient failures only (429 rate
   * limit, 5xx server errors) — never retries 401/403 (auth is either
   * right or it isn't, retrying won't fix it) or 4xx client errors other
   * than 429 (a malformed request will fail the same way every time).
   * Fixes a real bug (Codex review): previously a single transient
   * failure on one symbol would immediately throw and take down the
   * entire scan for every other symbol too.
   */
  private async fetchWithRetry(url: string, maxRetries = 2): Promise<Response> {
    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url, {
        headers: {
          "APCA-API-KEY-ID": this.config.apiKeyId,
          "APCA-API-SECRET-KEY": this.config.apiSecretKey,
        },
      });

      const isTransient = response.status === 429 || response.status >= 500;
      if (response.ok || !isTransient || attempt === maxRetries) {
        return response;
      }

      lastResponse = response;
      const backoffMs = 300 * Math.pow(2, attempt); // 300ms, 600ms, ...
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }

    // Unreachable in practice (the loop always returns on its last
    // iteration), but keeps TypeScript happy about a definite return.
    return lastResponse as Response;
  }

  async getCandles(params: GetCandlesParams): Promise<CandleSeries> {
    const { symbol, timeframe, limit = 100 } = params;
    const quality = this.dataQuality();
    const cacheKey = `${symbol}:${timeframe}:${limit}`;

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (!this.rateLimiter.canProceed()) {
      const waitMs = this.rateLimiter.msUntilNextSlot();
      throw new Error(
        `Alpaca rate limit reached. Try again in ${Math.ceil(waitMs / 1000)}s. ` +
          `Consider caching or reducing watchlist size.`
      );
    }

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

    this.rateLimiter.recordRequest();

    const response = await this.fetchWithRetry(url.toString());

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
    const sessionScoped = timeframe === "1d" ? allCandles : filterToLatestSession(allCandles);

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
