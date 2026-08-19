import { calculateAtr } from "@/lib/indicators/atr";
import { calculateVwap } from "@/lib/indicators/vwap";
import { getSessionTypeForTimestamp } from "@/lib/market-data/session";
import { getCurrentTradingDate } from "@/lib/risk/tradingDate";
import type { JournalEntry } from "@/types/journal";
import type { Candle } from "@/types/candle";
import type {
  GroundTruthLabel,
  LabelCandidateDecision,
  ReasonTag,
  RecordedSession,
} from "./types";

export interface LabelAssistantConfig {
  topRangePercentile: number;
  windowMinutes: number;
  windowTravelAtr: number;
  maxBackdatePullbackAtr: number;
  volumeWakeupMultiple: number;
  openingRangeMinutes: number;
}

export const DEFAULT_LABEL_ASSISTANT_CONFIG: LabelAssistantConfig = {
  topRangePercentile: 0.9,
  windowMinutes: 30,
  windowTravelAtr: 1,
  maxBackdatePullbackAtr: 0.15,
  volumeWakeupMultiple: 2,
  openingRangeMinutes: 15,
};

export interface LabelSparkline {
  times: number[];
  prices: number[];
  volumes: number[];
}

export interface LabelCandidate {
  id: string;
  tradingDate: string;
  symbol: string;
  rank: number;
  decision: LabelCandidateDecision;
  selectionReasons: Array<"top_decile_range" | "thirty_minute_travel">;
  rangeAtr: number;
  maxWindowTravelAtr: number;
  time_it_became_interesting: string;
  time_i_actually_noticed: string | null;
  direction: "bullish" | "bearish";
  reason_tags: ReasonTag[];
  editedFields: GroundTruthLabel["editedFields"];
  sparkline: LabelSparkline;
}

export interface CandidateGenerationResult {
  tradingDate: string;
  config: LabelAssistantConfig;
  eligibleSymbols: number;
  rangeDecileCutoff: number;
  candidates: LabelCandidate[];
}

export interface ExecutedTradeIngestion {
  labels: GroundTruthLabel[];
  skipped: Array<{ id: string; symbol: string; reason: "missing_entry_time" }>;
}

interface SymbolMove {
  symbol: string;
  bars: Candle[];
  priorDaily: Candle[];
  atr: number;
  rangeAtr: number;
  maxWindowTravelAtr: number;
  moveStartIndex: number;
  moveEndIndex: number;
  direction: "bullish" | "bearish";
}

function easternTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

function directionSign(direction: "bullish" | "bearish"): number {
  return direction === "bullish" ? 1 : -1;
}

/**
 * Causal back-dating primitive reserved for reuse by §3.13. It walks back
 * from the move endpoint to the first bar in the contiguous directional
 * path, stopping at a material counter-move. It never stamps the later
 * threshold-crossing bar.
 */
export function backdateContiguousMove(
  bars: Candle[],
  windowStartIndex: number,
  endIndex: number,
  direction: "bullish" | "bearish",
  atr: number,
  maxPullbackAtr: number
): number {
  const sign = directionSign(direction);
  let start = endIndex;
  const floor = Math.max(0, windowStartIndex);
  for (let index = endIndex - 1; index >= floor; index -= 1) {
    const pathDisplacement = sign * (bars[endIndex].close - bars[index].open);
    if (pathDisplacement <= 0) break;
    const nextStep = sign * (bars[index + 1].close - bars[index].close);
    if (nextStep < -(atr * maxPullbackAtr)) break;
    start = index;
  }
  return start;
}

function priorAtr(daily: Candle[], tradingDate: string): number | null {
  const prior = daily
    .filter((bar) => getCurrentTradingDate(new Date(bar.time * 1000)) < tradingDate)
    .sort((a, b) => a.time - b.time);
  const values = calculateAtr(prior, 14);
  const value = values.findLast(Number.isFinite);
  return value !== undefined && value > 0 ? value : null;
}

function strongestWindow(
  bars: Candle[],
  windowMinutes: number,
  atr: number,
  maxPullbackAtr: number
): Pick<SymbolMove, "maxWindowTravelAtr" | "moveStartIndex" | "moveEndIndex" | "direction"> {
  let best: Pick<SymbolMove, "maxWindowTravelAtr" | "moveStartIndex" | "moveEndIndex" | "direction"> = { maxWindowTravelAtr: 0, moveStartIndex: 0, moveEndIndex: 0, direction: "bullish" };
  for (let end = 0; end < bars.length; end += 1) {
    const start = Math.max(0, end - windowMinutes + 1);
    const displacement = bars[end].close - bars[start].open;
    const travelAtr = Math.abs(displacement) / atr;
    if (travelAtr <= best.maxWindowTravelAtr) continue;
    const direction = displacement >= 0 ? "bullish" : "bearish";
    best = {
      maxWindowTravelAtr: travelAtr,
      moveStartIndex: backdateContiguousMove(bars, start, end, direction, atr, maxPullbackAtr),
      moveEndIndex: end,
      direction,
    };
  }
  return best;
}

function crossed(previous: Candle | undefined, current: Candle, level: number, bullish: boolean): boolean {
  if (!previous) return false;
  return bullish
    ? previous.close <= level && current.close > level
    : previous.close >= level && current.close < level;
}

function suggestedReasonTags(
  move: SymbolMove,
  session: RecordedSession,
  config: LabelAssistantConfig
): ReasonTag[] {
  const tags = new Set<ReasonTag>(["range_expansion"]);
  const bars = move.bars;
  const index = move.moveStartIndex;
  const current = bars[index];
  const previous = bars[index - 1];
  const bullish = move.direction === "bullish";
  const allMinute = (session.bars[move.symbol]?.["1m"] ?? []).sort((a, b) => a.time - b.time);
  const premarket = allMinute.filter((bar) => getSessionTypeForTimestamp(new Date(bar.time * 1000)) === "pre-market");
  const prior = move.priorDaily.at(-1);
  const opening = bars.slice(0, config.openingRangeMinutes);
  const vwap = calculateVwap(bars.slice(0, index + 1));
  const previousVwap = index > 0 ? vwap[index - 1] : Number.NaN;
  const currentVwap = vwap[index];

  const recentVolumes = bars.slice(Math.max(0, index - 20), index).map((bar) => bar.volume).sort((a, b) => a - b);
  const medianVolume = recentVolumes.length === 0 ? 0 : recentVolumes[Math.floor(recentVolumes.length / 2)];
  if (medianVolume > 0 && current.volume >= medianVolume * config.volumeWakeupMultiple) tags.add("volume_wakeup");

  if (premarket.length > 0) {
    const pmHigh = Math.max(...premarket.map((bar) => bar.high));
    const pmLow = Math.min(...premarket.map((bar) => bar.low));
    if (crossed(previous, current, bullish ? pmHigh : pmLow, bullish)) tags.add(bullish ? "PMH_reclaim" : "PML_reclaim");
  }
  if (prior) {
    if (crossed(previous, current, bullish ? prior.high : prior.low, bullish)) tags.add(bullish ? "PDH_break" : "PDL_break");
  }
  if (Number.isFinite(previousVwap) && Number.isFinite(currentVwap)) {
    const wasOtherSide = bullish ? previous!.close <= previousVwap : previous!.close >= previousVwap;
    const nowBeyond = bullish ? current.close > currentVwap : current.close < currentVwap;
    if (previous && wasOtherSide && nowBeyond) tags.add(bullish ? "VWAP_reclaim" : "VWAP_loss");
  }
  if (opening.length === config.openingRangeMinutes && index >= config.openingRangeMinutes) {
    const level = bullish ? Math.max(...opening.map((bar) => bar.high)) : Math.min(...opening.map((bar) => bar.low));
    if (crossed(previous, current, level, bullish)) tags.add("opening_range");
  }
  const preceding = bars.slice(0, index);
  if (preceding.length > 0) {
    const extreme = bullish ? Math.max(...preceding.map((bar) => bar.high)) : Math.min(...preceding.map((bar) => bar.low));
    const tolerance = move.atr * 0.05;
    const retested = bullish
      ? current.low <= extreme + tolerance && current.close >= extreme
      : current.high >= extreme - tolerance && current.close <= extreme;
    if (retested) tags.add(bullish ? "HOD_retest" : "LOD_retest");
  }
  return [...tags];
}

function sparkline(bars: Candle[], centerIndex: number): LabelSparkline {
  const visible = bars.slice(Math.max(0, centerIndex - 20), Math.min(bars.length, centerIndex + 40));
  return {
    times: visible.map((bar) => bar.time),
    prices: visible.map((bar) => bar.close),
    volumes: visible.map((bar) => bar.volume),
  };
}

export function generateLabelCandidates(
  session: RecordedSession,
  excludedSymbols: Iterable<string> = [],
  config: LabelAssistantConfig = DEFAULT_LABEL_ASSISTANT_CONFIG
): CandidateGenerationResult {
  const excluded = new Set([...excludedSymbols].map((symbol) => symbol.toUpperCase()));
  const moves: SymbolMove[] = [];
  for (const [symbol, series] of Object.entries(session.bars)) {
    if (excluded.has(symbol.toUpperCase())) continue;
    const bars = (series["1m"] ?? [])
      .filter((bar) => getSessionTypeForTimestamp(new Date(bar.time * 1000)) === "regular")
      .sort((a, b) => a.time - b.time);
    const daily = (series["1d"] ?? []).sort((a, b) => a.time - b.time);
    const atr = priorAtr(daily, session.tradingDate);
    if (bars.length === 0 || atr === null) continue;
    const rangeAtr = (Math.max(...bars.map((bar) => bar.high)) - Math.min(...bars.map((bar) => bar.low))) / atr;
    moves.push({ symbol, bars, priorDaily: daily.filter((bar) => getCurrentTradingDate(new Date(bar.time * 1000)) < session.tradingDate), atr, rangeAtr, ...strongestWindow(bars, config.windowMinutes, atr, config.maxBackdatePullbackAtr) });
  }
  const ranges = moves.map((move) => move.rangeAtr).sort((a, b) => a - b);
  const cutoffIndex = Math.max(0, Math.ceil(ranges.length * config.topRangePercentile) - 1);
  const rangeDecileCutoff = ranges[cutoffIndex] ?? Number.POSITIVE_INFINITY;
  const selected = moves
    .filter((move) => move.rangeAtr >= rangeDecileCutoff || move.maxWindowTravelAtr >= config.windowTravelAtr)
    .sort((a, b) => Math.max(b.rangeAtr, b.maxWindowTravelAtr) - Math.max(a.rangeAtr, a.maxWindowTravelAtr));
  const candidates = selected.map((move, index): LabelCandidate => ({
    id: `${session.tradingDate}:${move.symbol}`,
    tradingDate: session.tradingDate,
    symbol: move.symbol,
    rank: index + 1,
    decision: "pending",
    selectionReasons: [
      ...(move.rangeAtr >= rangeDecileCutoff ? ["top_decile_range" as const] : []),
      ...(move.maxWindowTravelAtr >= config.windowTravelAtr ? ["thirty_minute_travel" as const] : []),
    ],
    rangeAtr: move.rangeAtr,
    maxWindowTravelAtr: move.maxWindowTravelAtr,
    time_it_became_interesting: easternTime(move.bars[move.moveStartIndex].time),
    time_i_actually_noticed: null,
    direction: move.direction,
    reason_tags: suggestedReasonTags(move, session, config),
    editedFields: [],
    sparkline: sparkline(move.bars, move.moveStartIndex),
  }));
  return { tradingDate: session.tradingDate, config, eligibleSymbols: moves.length, rangeDecileCutoff, candidates };
}

export function labelsFromExecutedTrades(entries: JournalEntry[], tradingDate: string): ExecutedTradeIngestion {
  const labels: GroundTruthLabel[] = [];
  const skipped: ExecutedTradeIngestion["skipped"] = [];
  for (const entry of entries.filter((item) => item.tradeDate === tradingDate)) {
    if (!entry.entryTime) {
      skipped.push({ id: entry.id, symbol: entry.symbol, reason: "missing_entry_time" });
      continue;
    }
    const time = easternTime(Math.floor(Date.parse(entry.entryTime) / 1000));
    labels.push({
      id: `executed:${entry.id}`,
      symbol: entry.symbol.toUpperCase(),
      time_it_became_interesting: time,
      time_i_actually_noticed: time,
      actual_notice_confidence: "high",
      direction: entry.direction === "long" ? "bullish" : "bearish",
      reason_tags: [],
      note: "Imported from an executed trade; selection-biased and not independent discovery evidence.",
      source: "executed_trade",
      selectionBiased: true,
      missedByCandidateGenerator: false,
      editedFields: [],
    });
  }
  return { labels, skipped };
}
