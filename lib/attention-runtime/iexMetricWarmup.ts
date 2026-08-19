import { exchangeCalendarDay } from "@/lib/attention/exchangeCalendar";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import type { Candle } from "@/types/candle";

export interface PriorSessionAtrSeed {
  completedTrueRanges: number[];
  previousClose: number | null;
}

export function minuteOfDay(bar: Candle): number {
  return getEasternTimeParts(new Date(bar.time * 1000)).minutesSinceMidnight;
}

export function aggregateCandle(previous: Candle | null, bar: Candle): Candle {
  return previous ? {
    time: previous.time,
    open: previous.open,
    high: Math.max(previous.high, bar.high),
    low: Math.min(previous.low, bar.low),
    close: bar.close,
    volume: previous.volume + bar.volume,
  } : { ...bar };
}

export function candleTrueRange(bar: Candle, previousClose: number | null): number {
  return previousClose === null
    ? bar.high - bar.low
    : Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
}

export function aggregateFiveMinuteBars(bars: readonly Candle[]): Candle[] {
  const groups = new Map<number, Candle>();
  for (const bar of [...bars].sort((a, b) => a.time - b.time)) {
    const key = Math.floor(bar.time / 300);
    groups.set(key, aggregateCandle(groups.get(key) ?? null, bar));
  }
  return [...groups.values()];
}

export function priorRegularSessionBars(bars: readonly Candle[]): Candle[] {
  return [...bars].filter((bar) => {
    const parts = getEasternTimeParts(new Date(bar.time * 1000));
    const day = exchangeCalendarDay(parts.date);
    return day.isTradingDay
      && parts.minutesSinceMidnight >= day.regularOpenMinutes!
      && parts.minutesSinceMidnight < day.regularCloseMinutes!;
  }).sort((a, b) => a.time - b.time);
}

export function buildPriorSessionAtrSeed(bars: readonly Candle[]): PriorSessionAtrSeed {
  const five = aggregateFiveMinuteBars(priorRegularSessionBars(bars));
  const ranges: number[] = [];
  let previousClose: number | null = null;
  for (const bar of five) {
    ranges.push(candleTrueRange(bar, previousClose));
    previousClose = bar.close;
  }
  return { completedTrueRanges: ranges.slice(-13), previousClose };
}

export function bridgeRegularOpenWindow(currentRecentBars: readonly Candle[], minuteOfDay: number, priorBars: readonly Candle[]): Candle[] {
  const current = [...currentRecentBars].sort((a, b) => a.time - b.time);
  if (minuteOfDay < 570 || minuteOfDay > 574) return current;
  const byMinute = new Map(current.map((bar) => [minuteOfDayForBridge(bar), bar]));
  const windowStart = minuteOfDay - 4;
  const missingPreOpen = Array.from({ length: Math.max(0, 570 - windowStart) }, (_, index) => windowStart + index)
    .filter((minute) => !byMinute.has(minute));
  const prior = priorRegularSessionBars(priorBars).slice(-missingPreOpen.length);
  const priorBySlot = new Map(missingPreOpen.map((minute, index) => [minute, prior[index]]));
  const result: Candle[] = [];
  for (let minute = windowStart; minute <= minuteOfDay; minute += 1) {
    const bar = byMinute.get(minute) ?? priorBySlot.get(minute);
    if (bar) result.push(bar);
  }
  return result;
}

function minuteOfDayForBridge(bar: Candle): number {
  return getEasternTimeParts(new Date(bar.time * 1000)).minutesSinceMidnight;
}

export function aggregateDailyBar(bars: readonly Candle[]): Candle | null {
  let result: Candle | null = null;
  for (const bar of priorRegularSessionBars(bars)) result = aggregateCandle(result, bar);
  return result;
}
