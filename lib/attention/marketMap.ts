import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import { calculateVwap } from "@/lib/indicators/vwap";
import { confirmedPivotLevels } from "@/lib/trend/facts";
import { exchangeCalendarDay } from "./exchangeCalendar";
import type { Candle } from "@/types/candle";

export type MarketMapLevelKind =
  | "PMH"
  | "PML"
  | "PDH"
  | "PDL"
  | "PRIOR_CLOSE"
  | "ORH"
  | "ORL"
  | "VWAP"
  | "HOD"
  | "LOD"
  | "SWING_HIGH"
  | "SWING_LOW"
  | "CONSOLIDATION_HIGH"
  | "CONSOLIDATION_LOW";

export interface MarketMapConfig {
  openingRangeMinutes: 5 | 15 | 30;
  pivotLength: number;
  minimumSwingAtr: number;
  minimumSwingMinutes: number;
  interactionToleranceAtr: number;
  consolidationBars: number;
  consolidationMaximumAtr: number;
}

export const DEFAULT_MARKET_MAP_CONFIG: MarketMapConfig = {
  openingRangeMinutes: 15,
  pivotLength: 2,
  minimumSwingAtr: 0.5,
  minimumSwingMinutes: 15,
  interactionToleranceAtr: 0.08,
  consolidationBars: 4,
  consolidationMaximumAtr: 1,
};

export interface MarketMapLevelRelevance {
  score: number;
  automaticPriority: number;
  reactionCount: number;
  reclaimCount: number;
  volumeAtInteractionRatio: number | null;
  rejectionStrengthAtr: number;
  lastInteractionAt: number | null;
  stillUnbroken: boolean;
}

export interface MarketMapLevel {
  id: string;
  kind: MarketMapLevelKind;
  price: number;
  availableFrom: number;
  dynamic: boolean;
  relevance: MarketMapLevelRelevance;
}

export interface MarketMapReference {
  label: string;
  levelId: string;
  kind: MarketMapLevelKind;
  price: number;
  distancePct: number;
  distanceAtr: number | null;
  expectedMoveFraction: number | null;
  relevanceScore: number;
}

export interface CheapSessionMapState {
  symbol: string;
  at: number;
  price: number;
  vwap: number | null;
  hod: number;
  lod: number;
}

export interface MarketMapSnapshot extends CheapSessionMapState {
  tradingDate: string;
  atr: number | null;
  expectedSessionMove: number | null;
  openingRangeMinutes: 5 | 15 | 30;
  levels: MarketMapLevel[];
  nearestUpside: MarketMapReference | null;
  nextUpside: MarketMapReference | null;
  nearestDownside: MarketMapReference | null;
  nextDownside: MarketMapReference | null;
}

export interface MarketMapInput {
  symbol: string;
  tradingDate: string;
  at: number;
  oneMinuteBars: readonly Candle[];
  fiveMinuteBars: readonly Candle[];
  priorDailyBar: Candle | null;
  atr: number | null;
  expectedSessionMove?: number | null;
}

export interface UniverseMarketMaps {
  cheapBySymbol: Record<string, CheapSessionMapState>;
  detailedBySymbol: Record<string, MarketMapSnapshot>;
}

function validateConfig(config: MarketMapConfig): void {
  if (![5, 15, 30].includes(config.openingRangeMinutes))
    throw new Error("Opening range must be 5, 15, or 30 minutes.");
  if (
    !Number.isInteger(config.pivotLength) ||
    config.pivotLength < 1 ||
    !Number.isInteger(config.minimumSwingMinutes) ||
    config.minimumSwingMinutes < 1 ||
    !Number.isInteger(config.consolidationBars) ||
    config.consolidationBars < 3 ||
    config.minimumSwingAtr <= 0 ||
    config.interactionToleranceAtr <= 0 ||
    config.consolidationMaximumAtr <= 0
  )
    throw new Error("Market Map configuration is invalid.");
}

function minuteOfDay(bar: Candle): number {
  return getEasternTimeParts(new Date(bar.time * 1000)).minutesSinceMidnight;
}

function completed(input: MarketMapInput, bars: readonly Candle[]): Candle[] {
  return bars
    .filter((bar) => bar.time * 1000 <= input.at)
    .sort((a, b) => a.time - b.time);
}

function latestPrice(bars: readonly Candle[]): number {
  const price = bars.at(-1)?.close;
  if (price === undefined || !Number.isFinite(price) || price <= 0)
    throw new Error("Market Map requires a positive completed close.");
  return price;
}

export function computeCheapSessionMap(
  input: MarketMapInput,
): CheapSessionMapState {
  const bars = completed(input, input.oneMinuteBars);
  if (bars.length === 0)
    throw new Error(
      `Market Map has no completed one-minute bars for ${input.symbol}.`,
    );
  const vwapSeries = calculateVwap(bars);
  const vwap = vwapSeries.at(-1);
  return {
    symbol: input.symbol,
    at: input.at,
    price: latestPrice(bars),
    vwap: vwap !== undefined && Number.isFinite(vwap) ? vwap : null,
    hod: Math.max(...bars.map((bar) => bar.high)),
    lod: Math.min(...bars.map((bar) => bar.low)),
  };
}

interface CandidateLevel {
  kind: MarketMapLevelKind;
  price: number;
  availableFrom: number;
  dynamic: boolean;
}

function sessionLevels(
  input: MarketMapInput,
  bars: readonly Candle[],
  cheap: CheapSessionMapState,
  config: MarketMapConfig,
): CandidateLevel[] {
  const calendar = exchangeCalendarDay(input.tradingDate);
  if (
    !calendar.isTradingDay ||
    calendar.regularOpenMinutes === null ||
    calendar.premarketOpenMinutes === null
  )
    throw new Error(
      `Market Map cannot build a session on ${input.tradingDate}.`,
    );
  const open = calendar.regularOpenMinutes;
  const premarket = bars.filter(
    (bar) =>
      minuteOfDay(bar) >= calendar.premarketOpenMinutes! &&
      minuteOfDay(bar) < open,
  );
  const regular = bars.filter((bar) => minuteOfDay(bar) >= open);
  const result: CandidateLevel[] = [];
  const add = (
    kind: MarketMapLevelKind,
    price: number | undefined,
    availableFrom: number,
    dynamic: boolean,
  ) => {
    if (price !== undefined && Number.isFinite(price))
      result.push({ kind, price, availableFrom, dynamic });
  };
  if (premarket.length) {
    const available = premarket.at(-1)!.time * 1000;
    add("PMH", Math.max(...premarket.map((bar) => bar.high)), available, false);
    add("PML", Math.min(...premarket.map((bar) => bar.low)), available, false);
  }
  if (input.priorDailyBar) {
    const available = bars[0].time * 1000;
    add("PDH", input.priorDailyBar.high, available, false);
    add("PDL", input.priorDailyBar.low, available, false);
    add("PRIOR_CLOSE", input.priorDailyBar.close, available, false);
  }
  const rangeEnd = open + config.openingRangeMinutes;
  const currentMinute = minuteOfDay(bars.at(-1)!);
  if (currentMinute >= rangeEnd) {
    const openingBars = regular.filter(
      (bar) => minuteOfDay(bar) >= open && minuteOfDay(bar) < rangeEnd,
    );
    if (openingBars.length) {
      const available =
        input.at - Math.max(0, currentMinute - rangeEnd) * 60_000;
      add(
        "ORH",
        Math.max(...openingBars.map((bar) => bar.high)),
        available,
        false,
      );
      add(
        "ORL",
        Math.min(...openingBars.map((bar) => bar.low)),
        available,
        false,
      );
    }
  }
  add("VWAP", cheap.vwap ?? undefined, input.at, true);
  add("HOD", cheap.hod, input.at, true);
  add("LOD", cheap.lod, input.at, true);
  return result;
}

function meaningfulSwings(
  input: MarketMapInput,
  config: MarketMapConfig,
): CandidateLevel[] {
  const bars = completed(input, input.fiveMinuteBars);
  if (input.atr === null || input.atr <= 0 || bars.length === 0) return [];
  const candidates = [
    ...confirmedPivotLevels(bars, config.pivotLength, "bullish")
      .filter(
        (level): level is typeof level & { availableFrom: string } =>
          level.availableFrom !== null,
      )
      .map((level) => ({
        kind: "SWING_HIGH" as const,
        price: level.price,
        availableFrom: Date.parse(level.availableFrom),
        dynamic: true,
      })),
    ...confirmedPivotLevels(bars, config.pivotLength, "bearish")
      .filter(
        (level): level is typeof level & { availableFrom: string } =>
          level.availableFrom !== null,
      )
      .map((level) => ({
        kind: "SWING_LOW" as const,
        price: level.price,
        availableFrom: Date.parse(level.availableFrom),
        dynamic: true,
      })),
  ].sort((a, b) => a.availableFrom - b.availableFrom);
  const accepted: CandidateLevel[] = [];
  for (const candidate of candidates) {
    const previous = [...accepted]
      .reverse()
      .find((row) => row.kind === candidate.kind);
    if (
      previous &&
      (candidate.availableFrom - previous.availableFrom <
        config.minimumSwingMinutes * 60_000 ||
        Math.abs(candidate.price - previous.price) <
          config.minimumSwingAtr * input.atr)
    )
      continue;
    accepted.push(candidate);
  }
  return accepted;
}

function consolidation(
  input: MarketMapInput,
  config: MarketMapConfig,
): CandidateLevel[] {
  const bars = completed(input, input.fiveMinuteBars).slice(
    -config.consolidationBars,
  );
  if (
    input.atr === null ||
    input.atr <= 0 ||
    bars.length < config.consolidationBars
  )
    return [];
  const high = Math.max(...bars.map((bar) => bar.high));
  const low = Math.min(...bars.map((bar) => bar.low));
  if ((high - low) / input.atr > config.consolidationMaximumAtr) return [];
  const availableFrom = bars.at(-1)!.time * 1000;
  return [
    {
      kind: "CONSOLIDATION_HIGH",
      price: high,
      availableFrom,
      dynamic: true,
    },
    {
      kind: "CONSOLIDATION_LOW",
      price: low,
      availableFrom,
      dynamic: true,
    },
  ];
}

function isUpper(kind: MarketMapLevelKind): boolean {
  return [
    "PMH",
    "PDH",
    "ORH",
    "HOD",
    "SWING_HIGH",
    "CONSOLIDATION_HIGH",
  ].includes(kind);
}

function isLower(kind: MarketMapLevelKind): boolean {
  return [
    "PML",
    "PDL",
    "ORL",
    "LOD",
    "SWING_LOW",
    "CONSOLIDATION_LOW",
  ].includes(kind);
}

function relevance(
  candidate: CandidateLevel,
  bars: readonly Candle[],
  input: MarketMapInput,
  config: MarketMapConfig,
): MarketMapLevelRelevance {
  const atr = input.atr && input.atr > 0 ? input.atr : null;
  const tolerance =
    (atr ?? candidate.price * 0.005) * config.interactionToleranceAtr;
  const availableBars = bars.filter(
    (bar) => bar.time * 1000 >= candidate.availableFrom,
  );
  const touches: number[] = [];
  let reclaimCount = 0;
  let rejectionStrengthAtr = 0;
  for (let index = 0; index < availableBars.length; index += 1) {
    const bar = availableBars[index];
    if (
      bar.low <= candidate.price + tolerance &&
      bar.high >= candidate.price - tolerance
    ) {
      touches.push(index);
      if (atr) {
        const future = availableBars.slice(index, index + 4);
        rejectionStrengthAtr = Math.max(
          rejectionStrengthAtr,
          ...future.map((next) => Math.abs(next.close - candidate.price) / atr),
        );
      }
    }
    if (index > 0) {
      const previous = availableBars[index - 1].close - candidate.price;
      const current = bar.close - candidate.price;
      if (
        (previous < -tolerance && current > tolerance) ||
        (previous > tolerance && current < -tolerance)
      )
        reclaimCount += 1;
    }
  }
  const medianVolume = bars.length
    ? quantileNumber(
        bars.map((bar) => bar.volume),
        0.5,
      )
    : 0;
  const touchedVolumes = touches.map((index) => availableBars[index].volume);
  const volumeAtInteractionRatio =
    touchedVolumes.length && medianVolume > 0
      ? quantileNumber(touchedVolumes, 0.5) / medianVolume
      : null;
  const lastInteractionAt = touches.length
    ? availableBars[touches.at(-1)!].time * 1000
    : null;
  const stillUnbroken = isUpper(candidate.kind)
    ? !availableBars.some((bar) => bar.close > candidate.price + tolerance)
    : isLower(candidate.kind)
      ? !availableBars.some((bar) => bar.close < candidate.price - tolerance)
      : true;
  const open = exchangeCalendarDay(input.tradingDate).regularOpenMinutes ?? 570;
  const nowMinute = minuteOfDay(bars.at(-1)!);
  const automaticPriority =
    candidate.kind === "PMH" || candidate.kind === "PML"
      ? nowMinute < open
        ? 1
        : Math.max(0, 1 - (nowMinute - open) / 240)
      : 0;
  const recency =
    lastInteractionAt === null
      ? 0
      : Math.max(0, 1 - (input.at - lastInteractionAt) / (180 * 60_000));
  const observed =
    Math.min(1, touches.length / 3) * 25 +
    Math.min(1, volumeAtInteractionRatio ?? 0) * 15 +
    Math.min(1, rejectionStrengthAtr) * 20 +
    Math.min(1, reclaimCount / 2) * 15 +
    (stillUnbroken ? 15 : 0) +
    recency * 10;
  return {
    score: Math.min(100, observed + automaticPriority * 10),
    automaticPriority,
    reactionCount: touches.length,
    reclaimCount,
    volumeAtInteractionRatio,
    rejectionStrengthAtr,
    lastInteractionAt,
    stillUnbroken,
  };
}

function quantileNumber(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function reference(
  level: MarketMapLevel,
  price: number,
  atr: number | null,
  expectedMove: number | null,
  ordinal: "Nearest" | "Next",
  direction: "upside" | "downside",
): MarketMapReference {
  const distance = Math.abs(level.price - price);
  return {
    label: `${ordinal} ${direction} reference: ${level.kind}`,
    levelId: level.id,
    kind: level.kind,
    price: level.price,
    distancePct: (distance / price) * 100,
    distanceAtr: atr && atr > 0 ? distance / atr : null,
    expectedMoveFraction:
      expectedMove && expectedMove > 0 ? distance / expectedMove : null,
    relevanceScore: level.relevance.score,
  };
}

export function buildMarketMap(
  input: MarketMapInput,
  config: MarketMapConfig = DEFAULT_MARKET_MAP_CONFIG,
): MarketMapSnapshot {
  validateConfig(config);
  if (!input.symbol || input.symbol !== input.symbol.toUpperCase())
    throw new Error("Market Map requires a normalized symbol.");
  const bars = completed(input, input.oneMinuteBars);
  const cheap = computeCheapSessionMap(input);
  const candidates = [
    ...sessionLevels(input, bars, cheap, config),
    ...meaningfulSwings(input, config),
    ...consolidation(input, config),
  ];
  const levels = candidates
    .map((candidate) => ({
      id: `${input.tradingDate}:${candidate.kind}:${candidate.availableFrom}:${candidate.price.toFixed(6)}`,
      ...candidate,
      relevance: relevance(candidate, bars, input, config),
    }))
    .sort(
      (a, b) =>
        b.relevance.score - a.relevance.score ||
        a.price - b.price ||
        a.id.localeCompare(b.id),
    );
  const upside = levels
    .filter((level) => level.price > cheap.price)
    .sort((a, b) => a.price - b.price || b.relevance.score - a.relevance.score);
  const downside = levels
    .filter((level) => level.price < cheap.price)
    .sort((a, b) => b.price - a.price || b.relevance.score - a.relevance.score);
  const expectedMove = input.expectedSessionMove ?? null;
  return {
    ...cheap,
    tradingDate: input.tradingDate,
    atr: input.atr,
    expectedSessionMove: expectedMove,
    openingRangeMinutes: config.openingRangeMinutes,
    levels,
    nearestUpside: upside[0]
      ? reference(
          upside[0],
          cheap.price,
          input.atr,
          expectedMove,
          "Nearest",
          "upside",
        )
      : null,
    nextUpside: upside[1]
      ? reference(
          upside[1],
          cheap.price,
          input.atr,
          expectedMove,
          "Next",
          "upside",
        )
      : null,
    nearestDownside: downside[0]
      ? reference(
          downside[0],
          cheap.price,
          input.atr,
          expectedMove,
          "Nearest",
          "downside",
        )
      : null,
    nextDownside: downside[1]
      ? reference(
          downside[1],
          cheap.price,
          input.atr,
          expectedMove,
          "Next",
          "downside",
        )
      : null,
  };
}

export function buildUniverseMarketMaps(
  inputs: readonly MarketMapInput[],
  activeSymbols: ReadonlySet<string>,
  config: MarketMapConfig = DEFAULT_MARKET_MAP_CONFIG,
): UniverseMarketMaps {
  const cheapBySymbol: Record<string, CheapSessionMapState> = {};
  const detailedBySymbol: Record<string, MarketMapSnapshot> = {};
  for (const input of inputs) {
    cheapBySymbol[input.symbol] = computeCheapSessionMap(input);
    if (activeSymbols.has(input.symbol))
      detailedBySymbol[input.symbol] = buildMarketMap(input, config);
  }
  return { cheapBySymbol, detailedBySymbol };
}
