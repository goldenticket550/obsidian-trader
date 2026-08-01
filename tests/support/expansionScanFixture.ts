import type { Candle, CandleSeries } from "@/types/candle";
import type { GetCandlesParams, MarketDataProvider, SessionInfo } from "@/lib/market-data/types";
import { computeSessionInfo } from "@/lib/market-data/session";

/**
 * A deterministic multi-session provider fixture for the Feature A
 * integration tests.
 *
 * `MockProvider` serves one fixed session from `mockScanInputs`, which
 * cannot express what the Premarket Expansion Candidate actually consumes:
 * twenty-one sessions of extended-hours bars for the historical baseline,
 * plus a benchmark with bar timestamps that line up exactly with the
 * symbol's. Everything here is generated from explicit parameters so a
 * test can say "this symbol is expanding" and "this one is ordinary"
 * without hand-writing thousands of bars.
 */

/** 9:35 AM ET on Monday 2026-07-13, during EDT (UTC-4). */
export const SCAN_NOW = "2026-07-13T13:35:00Z";
/**
 * 11:00 AM ET the same day.
 *
 * Rule D's benchmark alignment needs eleven completed bars (a 9 EMA plus
 * its floor), which at 9:35 simply do not exist yet — one regular bar has
 * closed. Tests about the REVERSAL path's benchmark therefore run midday,
 * where the alignment is genuinely evaluable and a blanked benchmark
 * series is actually observable.
 */
export const SCAN_NOW_MIDDAY = "2026-07-13T15:00:00Z";
/** Last regular-hours 5m bar completed by SCAN_NOW_MIDDAY. */
export const MIDDAY_LAST_BAR_MINUTE = 10 * 60 + 55;
export const TODAY_TRADING_DATE = "2026-07-13";

/**
 * Twenty-one consecutive weekday sessions ending today. Deliberately
 * enumerated: no market-holiday calendar exists in this repo, and a
 * generated range would drift if this file were ever re-dated.
 */
export const SESSION_DATES = [
  "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19",
  "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26",
  "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03",
  "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
  TODAY_TRADING_DATE,
];

export const PRIOR_TRADING_DATE = "2026-07-10";

const PREMARKET_OPEN = 4 * 60;
const REGULAR_OPEN = 9 * 60 + 30;

/** Epoch seconds for a US Eastern minute-of-day during EDT. */
export function etTime(date: string, minuteOfDay: number): number {
  const utcMinutes = minuteOfDay + 4 * 60;
  const hh = String(Math.floor(utcMinutes / 60)).padStart(2, "0");
  const mm = String(utcMinutes % 60).padStart(2, "0");
  return Math.floor(Date.parse(`${date}T${hh}:${mm}:00Z`) / 1000);
}

interface SessionShape {
  /** Price the session's premarket opens at. */
  open: number;
  /** Total drift across the premarket window; positive rises, negative falls. */
  drift: number;
  /** Half-height of each bar around its own close. */
  barRange: number;
  volumePerBar: number;
}

/**
 * One session's premarket bars, 4:00 through 9:25 ET at five minutes.
 *
 * The last bar opens 9:25 and completes exactly at 9:30, so the session
 * reaches the premarket cutoff with no tail gap and full coverage — the
 * two eligibility gates `aggregateThroughCutoff` applies.
 */
function premarketSession(date: string, shape: SessionShape, interval = 5): Candle[] {
  const bars: Candle[] = [];
  const count = (REGULAR_OPEN - PREMARKET_OPEN) / interval;
  for (let i = 0; i < count; i++) {
    const minute = PREMARKET_OPEN + i * interval;
    const progress = i / (count - 1);
    const close = shape.open + shape.drift * progress;
    const prior = i === 0 ? shape.open : shape.open + shape.drift * ((i - 1) / (count - 1));
    bars.push({
      time: etTime(date, minute),
      open: prior,
      high: Math.max(prior, close) + shape.barRange,
      low: Math.min(prior, close) - shape.barRange,
      close,
      volume: shape.volumePerBar,
    });
  }
  return bars;
}

/** Regular-hours bars, from the open through `throughMinute`. */
function regularSession(
  date: string,
  from: number,
  throughMinute: number,
  price: number,
  interval = 5
): Candle[] {
  const bars: Candle[] = [];
  for (let minute = from; minute <= throughMinute; minute += interval) {
    bars.push({
      time: etTime(date, minute),
      open: price,
      high: price + 0.3,
      low: price - 0.3,
      close: price,
      volume: 5000,
    });
  }
  return bars;
}

function dailySeries(dates: string[], high: number, low: number, close: number): Candle[] {
  return dates.map((date) => ({
    // Daily bars are stamped at the 4:00 PM ET close, matching how the
    // provider returns them.
    time: etTime(date, 16 * 60),
    open: close,
    high,
    low,
    close,
    volume: 1_000_000,
  }));
}

export interface SymbolFixture {
  /** Shape used for the twenty prior sessions. */
  priorShape: SessionShape;
  /** Shape used for today — this is what makes a symbol "expanding" or not. */
  todayShape: SessionShape;
  dailyHigh: number;
  dailyLow: number;
  dailyClose: number;
  /** When set, every provider call for this symbol throws. */
  failsEntirely?: boolean;
  /** When set, only the multi-session baseline request throws. */
  baselineFails?: boolean;
  /**
   * When set, only the single-session EXTENDED request throws — the shape
   * of a benchmark whose premarket series is unavailable while its
   * regular-hours series is fine.
   */
  extendedFails?: boolean;
  /**
   * How many sessions of history the multi-session request covers, counting
   * back from today. Defaults to all of them. A young symbol has complete
   * data for every session it has existed — that is not truncation.
   */
  historySessions?: number;
  /** Reported pagination completeness. Defaults to true. */
  paginationComplete?: boolean;
}

/**
 * A symbol whose premarket is unmistakably expanding: four times the
 * usual volume, four times the usual range, rising, and trading clear of
 * the prior day's high.
 */
export const EXPANDING: SymbolFixture = {
  priorShape: { open: 100, drift: 0.5, barRange: 0.25, volumePerBar: 1000 },
  todayShape: { open: 100, drift: 4, barRange: 1, volumePerBar: 4000 },
  dailyHigh: 101,
  dailyLow: 98,
  dailyClose: 100,
};

/** An ordinary symbol: today looks like every other session. */
export const ORDINARY: SymbolFixture = {
  priorShape: { open: 50, drift: 0.2, barRange: 0.1, volumePerBar: 1000 },
  todayShape: { open: 50, drift: 0.2, barRange: 0.1, volumePerBar: 1000 },
  dailyHigh: 55,
  dailyLow: 49,
  dailyClose: 50,
};

export class FixtureProvider implements MarketDataProvider {
  name = "fixture";
  calls: GetCandlesParams[] = [];

  constructor(
    private readonly symbols: Record<string, SymbolFixture>,
    /**
     * Eastern minute-of-day of the last completed regular bar. Defaults to
     * the 9:30 open — one bar, which is all that has closed at SCAN_NOW.
     */
    private readonly regularThroughMinute: number = REGULAR_OPEN
  ) {}

  /** Every call this provider has served, for asserting request counts. */
  callsFor(symbol: string): GetCandlesParams[] {
    return this.calls.filter((c) => c.symbol === symbol);
  }

  reset(): void {
    this.calls = [];
  }

  feedInfo() {
    return { feed: "fixture-feed", delayed: false, knownDelayMinutes: null };
  }

  async getCandles(params: GetCandlesParams): Promise<CandleSeries> {
    this.calls.push(params);
    const fixture = this.symbols[params.symbol];

    if (!fixture) {
      return {
        symbol: params.symbol,
        timeframe: params.timeframe,
        quality: "simulated",
        candles: [],
      };
    }
    if (fixture.failsEntirely) {
      throw new Error(`fixture: ${params.symbol} is unavailable`);
    }

    const multiSession = (params.sessionCount ?? 1) > 1;
    if (multiSession && fixture.baselineFails) {
      throw new Error(`fixture: no historical bars for ${params.symbol}`);
    }
    if (!multiSession && params.sessionScope === "extended" && fixture.extendedFails) {
      throw new Error(`fixture: no premarket series for ${params.symbol}`);
    }

    const candles = this.seriesFor(params, fixture, multiSession);
    const complete = fixture.paginationComplete ?? true;

    return {
      symbol: params.symbol,
      timeframe: params.timeframe,
      quality: "simulated",
      candles,
      pagination: {
        complete,
        pagesFetched: 1,
        nextPageTokenRemaining: !complete,
        truncationReason: complete ? null : "page_cap_reached",
      },
    };
  }

  private seriesFor(
    params: GetCandlesParams,
    fixture: SymbolFixture,
    multiSession: boolean
  ): Candle[] {
    if (params.timeframe === "1d") {
      return dailySeries(SESSION_DATES, fixture.dailyHigh, fixture.dailyLow, fixture.dailyClose);
    }

    // Bar spacing follows the requested timeframe: a 1-minute request that
    // silently returned 5-minute bars would make every time-of-day
    // baseline look empty for reasons that have nothing to do with the
    // code under test.
    const interval = params.timeframe === "1m" ? 1 : 5;

    const todayPremarket = premarketSession(TODAY_TRADING_DATE, fixture.todayShape, interval);
    const lastPremarketClose = todayPremarket[todayPremarket.length - 1].close;
    // 9:30 opens and completes at 9:35, so the default is exactly one
    // completed regular bar — what has actually closed at SCAN_NOW.
    const todayRegular = regularSession(
      TODAY_TRADING_DATE,
      REGULAR_OPEN,
      this.regularThroughMinute,
      lastPremarketClose,
      interval
    );

    if (multiSession) {
      // The historical baseline request: every session this symbol has,
      // extended scope. A `historySessions` limit keeps today and drops the
      // OLDEST sessions — a symbol that simply has not existed for longer.
      const priorDates = SESSION_DATES.slice(0, -1);
      const kept =
        fixture.historySessions === undefined
          ? priorDates
          : priorDates.slice(-(Math.max(1, fixture.historySessions) - 1));

      // Prior sessions carry their regular-hours bars too, so a
      // minute-of-day baseline exists for bars after the open.
      const priorClose = fixture.priorShape.open + fixture.priorShape.drift;
      return [
        ...kept.flatMap((d) => [
          ...premarketSession(d, fixture.priorShape, interval),
          ...regularSession(d, REGULAR_OPEN, this.regularThroughMinute, priorClose, interval),
        ]),
        ...todayPremarket,
        ...todayRegular,
      ];
    }

    if (params.timeframe === "15m") {
      return [
        {
          ...todayRegular[0],
          time: etTime(TODAY_TRADING_DATE, REGULAR_OPEN),
        },
      ];
    }

    // 5m: extended scope carries today's premarket plus the regular bar;
    // the default regular scope carries only the regular bar.
    return params.sessionScope === "extended"
      ? [...todayPremarket, ...todayRegular]
      : todayRegular;
  }

  async getSessionInfo(): Promise<SessionInfo> {
    return computeSessionInfo();
  }
}

/**
 * The standard cast used across the integration tests: one clearly
 * expanding symbol, one ordinary one, and the benchmark every symbol
 * resolves to. The benchmark shares the expanding symbol's bar
 * timestamps, which is what the relative-strength rule requires.
 */
export function standardFixtures(
  overrides: Record<string, Partial<SymbolFixture>> = {}
): Record<string, SymbolFixture> {
  const base: Record<string, SymbolFixture> = {
    EXPD: EXPANDING,
    CALM: ORDINARY,
    QQQ: ORDINARY,
  };
  for (const [symbol, patch] of Object.entries(overrides)) {
    base[symbol] = { ...(base[symbol] ?? ORDINARY), ...patch };
  }
  return base;
}

export const STANDARD_SYMBOLS = [
  { symbol: "EXPD", exchange: "NASDAQ" },
  { symbol: "CALM", exchange: "NASDAQ" },
];
