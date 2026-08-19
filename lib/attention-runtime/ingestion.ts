import { exchangeCalendarDay, exchangePremarketOpenAt, exchangeRegularCloseAt, exchangeRegularOpenAt, previousExchangeTradingDate } from "@/lib/attention/exchangeCalendar";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import type { MarketDataProvider } from "@/lib/market-data/types";
import type { Candle } from "@/types/candle";
import type { IngestionGuardState, LiveIngestionMode, LiveMinuteBatch } from "./contracts";
import { priorRegularSessionBars } from "./iexMetricWarmup";

export interface StreamCapabilityResult {
  mode: "iex_websocket" | "iex_rest_polling";
  requestedSymbols: number;
  acknowledgedSymbols: number;
  complete: boolean;
  reason: string;
  probedAt: number;
}

export interface WebSocketLike {
  addEventListener(type: "message" | "error" | "close" | "open", listener: (event: any) => void): void;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export async function probeIexStreamCapability(input: {
  symbols: readonly string[];
  apiKeyId: string;
  apiSecretKey: string;
  now?: number;
  timeoutMs?: number;
  createWebSocket?: WebSocketFactory;
}): Promise<StreamCapabilityResult> {
  const now = input.now ?? Date.now(), timeoutMs = input.timeoutMs ?? 10_000;
  if (!input.symbols.length) throw new Error("Stream capability probe requires symbols.");
  const create = input.createWebSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  return await new Promise<StreamCapabilityResult>((resolve) => {
    const socket = create("wss://stream.data.alpaca.markets/v2/iex");
    let settled = false;
    const finish = (acknowledgedSymbols: number, reason: string) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.close();
      const complete = acknowledgedSymbols === input.symbols.length;
      resolve({ mode: complete ? "iex_websocket" : "iex_rest_polling", requestedSymbols: input.symbols.length, acknowledgedSymbols, complete, reason, probedAt: now });
    };
    const timer = setTimeout(() => finish(0, "subscription_ack_timeout"), timeoutMs);
    socket.addEventListener("message", (message) => {
      let rows: Array<{ T?: string; msg?: string; bars?: string[]; code?: number }>;
      try { rows = JSON.parse(String(message.data)) as typeof rows; } catch { finish(0, "invalid_stream_message"); return; }
      for (const row of rows) {
        if (row.T === "success" && row.msg === "connected") socket.send(JSON.stringify({ action: "auth", key: input.apiKeyId, secret: input.apiSecretKey }));
        else if (row.T === "success" && row.msg === "authenticated") socket.send(JSON.stringify({ action: "subscribe", bars: input.symbols }));
        else if (row.T === "subscription") finish(new Set(row.bars ?? []).size, "subscription_acknowledged");
        else if (row.T === "error") finish(0, `stream_error_${row.code ?? "unknown"}`);
      }
    });
    socket.addEventListener("error", () => finish(0, "stream_socket_error"));
    socket.addEventListener("close", () => finish(0, "stream_closed_before_ack"));
  });
}

export function inferIexHaltResumes(
  barsBySymbol: Readonly<Record<string, readonly Candle[]>>,
  completedAt: number,
  minimumGapMinutes = 5,
  minimumResumeGapPct = 0.005,
): string[] {
  const inferred: string[] = [];
  for (const [symbol, values] of Object.entries(barsBySymbol)) {
    const bars = [...values].sort((a, b) => a.time - b.time);
    const latest = bars.at(-1), prior = bars.at(-2);
    if (!latest || !prior || latest.time * 1000 !== completedAt) continue;
    const missingMinutes = Math.round((latest.time - prior.time) / 60) - 1;
    const resumeGapPct = prior.close > 0 ? Math.abs(latest.open / prior.close - 1) : 0;
    if (missingMinutes >= minimumGapMinutes && resumeGapPct >= minimumResumeGapPct) inferred.push(symbol);
  }
  return inferred.sort();
}
export interface LiveIngestionSource {
  readonly mode: LiveIngestionMode;
  readCompletedMinute(now: number): Promise<LiveMinuteBatch>;
}

function defaultGuard(reason: IngestionGuardState["reason"] = "none"): IngestionGuardState {
  return { active: reason !== "none", reason, activeSince: reason === "none" ? null : Date.now(), contiguousMinutes: reason === "none" ? 5 : 0, requiredContiguousMinutes: 5 };
}

export class RestIexPollingSource implements LiveIngestionSource {
  readonly mode = "iex_rest_polling" as const;
  private haltResumeGuardUntil = 0;
  private priorSessionCache: { tradingDate: string; barsBySymbol: Record<string, Candle[]> } | null = null;
  constructor(private readonly provider: MarketDataProvider, private readonly symbols: readonly string[], private readonly lookbackMinutes = 120) {
    if (!provider.getCandlesMulti) throw new Error("Live REST polling requires getCandlesMulti.");
  }

  private async loadPriorSession(tradingDate: string, now: number): Promise<Record<string, Candle[]>> {
    const priorTradingDate = previousExchangeTradingDate(tradingDate);
    if (this.priorSessionCache?.tradingDate === priorTradingDate) return this.priorSessionCache.barsBySymbol;
    const result = await this.provider.getCandlesMulti!({
      symbols: [...this.symbols],
      timeframe: "1m",
      start: exchangeRegularOpenAt(priorTradingDate).toISOString(),
      end: new Date(exchangeRegularCloseAt(priorTradingDate).getTime() - 1).toISOString(),
      adjustment: "split",
      deadlineAt: now + 25_000,
    });
    if (result.requestedFeed !== "iex" || result.responseFeed !== "iex") {
      throw new Error(`Prior-session IEX warm-up feed provenance mismatch: requested=${result.requestedFeed}, response=${result.responseFeed}.`);
    }
    if (!result.pagination.complete || result.pagination.nextPageTokenRemaining) {
      throw new Error(`Prior-session IEX warm-up is incomplete for ${priorTradingDate}.`);
    }
    const barsBySymbol = Object.fromEntries(this.symbols.map((symbol) => [
      symbol, priorRegularSessionBars(result.candlesBySymbol[symbol] ?? []),
    ]));
    this.priorSessionCache = { tradingDate: priorTradingDate, barsBySymbol };
    return barsBySymbol;
  }

  async readCompletedMinute(now: number): Promise<LiveMinuteBatch> {
    const fetchStartedAt = performance.now();
    const completedAt = Math.floor(now / 60_000) * 60_000 - 60_000;
    const et = getEasternTimeParts(new Date(completedAt));
    const calendar = exchangeCalendarDay(et.date);
    const regular = calendar.isTradingDay && et.minutesSinceMidnight >= 570 && et.minutesSinceMidnight < calendar.regularCloseMinutes!;
    if (!regular) {
      return {
        at: completedAt,
        tradingDate: et.date,
        minuteOfDay: et.minutesSinceMidnight,
        mode: this.mode,
        requestedSymbols: [...this.symbols],
        barsBySymbol: Object.fromEntries(this.symbols.map((symbol) => [symbol, []])),
        latestBarBySymbol: Object.fromEntries(this.symbols.map((symbol) => [symbol, null])),
        responseFeed: "iex",
        complete: true,
        staleSymbols: [],
        missingSymbols: [],
        guard: defaultGuard(),
        audit: ["dark_window_noop=non_regular", "provider_requests=0"],
        stageTimings: { providerFetchMs: performance.now() - fetchStartedAt, barReconciliationMs: 0 },
      };
    }
    const currentStartAt = et.minutesSinceMidnight < 635
      ? exchangePremarketOpenAt(et.date).getTime()
      : completedAt - this.lookbackMinutes * 60_000;
    const priorSessionRegularBarsBySymbol = await this.loadPriorSession(et.date, Date.now());
    const start = new Date(currentStartAt).toISOString();
    const end = new Date(completedAt + 59_999).toISOString();
    if (currentStartAt > completedAt + 59_999) {
      throw new Error(`Regular IEX poll window is invalid: start=${start}, end=${end}.`);
    }
    const result = await this.provider.getCandlesMulti!({ symbols: [...this.symbols], timeframe: "1m", start, end, adjustment: "split", deadlineAt: Date.now() + 25_000 });
    const fetchedAt = performance.now();
    if (result.requestedFeed !== "iex" || result.responseFeed !== "iex") throw new Error(`Live IEX poll feed provenance mismatch: requested=${result.requestedFeed}, response=${result.responseFeed}.`);
    const complete = result.pagination.complete && !result.pagination.nextPageTokenRemaining;
    const barsBySymbol: Record<string, Candle[]> = {}, latestBarBySymbol: Record<string, Candle | null> = {};
    const staleSymbols: string[] = [], missingSymbols: string[] = [];
    for (const symbol of this.symbols) {
      const bars = [...(result.candlesBySymbol[symbol] ?? [])].sort((a, b) => a.time - b.time).filter((bar) => {
        const parts = getEasternTimeParts(new Date(bar.time * 1000));
        return bar.time * 1000 <= completedAt && parts.date === et.date;
      });
      barsBySymbol[symbol] = bars;
      const latest = bars.at(-1) ?? null; latestBarBySymbol[symbol] = latest;
      if (!latest || latest.time * 1000 !== completedAt) missingSymbols.push(symbol);
      if (!latest || latest.time * 1000 < completedAt - 5 * 60_000) staleSymbols.push(symbol);
    }
    const minuteOfDay = et.minutesSinceMidnight;
    const inferredResumeSymbols = inferIexHaltResumes(barsBySymbol, completedAt);
    if (inferredResumeSymbols.length) this.haltResumeGuardUntil = completedAt + 5 * 60_000;
    const guard = !complete
      ? defaultGuard("partial_batch")
      : completedAt < this.haltResumeGuardUntil
        ? { ...defaultGuard("halt_resume_inferred"), activeSince: inferredResumeSymbols.length ? completedAt : this.haltResumeGuardUntil - 5 * 60_000 }
        : defaultGuard();
    return {
      at: completedAt, tradingDate: et.date, minuteOfDay, mode: this.mode,
      requestedSymbols: [...this.symbols], barsBySymbol, priorSessionRegularBarsBySymbol, latestBarBySymbol, responseFeed: "iex", complete,
      staleSymbols: staleSymbols.sort(), missingSymbols: missingSymbols.sort(), guard,
      audit: [`pages=${result.pagination.pagesFetched}`, `prior_session=${previousExchangeTradingDate(et.date)}`, `prior_warmup_bars=${Object.values(priorSessionRegularBarsBySymbol).reduce((sum, bars) => sum + bars.length, 0)}`, `missing_current_bars=${missingSymbols.length}`, `stale_symbols=${staleSymbols.length}`, `halt_inferred_resume_symbols=${inferredResumeSymbols.join(",") || "none"}`],
      stageTimings: { providerFetchMs: fetchedAt - fetchStartedAt, barReconciliationMs: performance.now() - fetchedAt },
    };
  }
}

