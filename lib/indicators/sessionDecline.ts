import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";

export interface IntradayDeclineResult {
  passed: boolean;
  declineFromOpenPct: number;
  declineFromPrevClosePct: number;
}

/**
 * Stage 1: has the stock declined meaningfully during the session?
 * Checks decline from session open AND from previous close; passes if
 * either configured threshold is met (the stock qualifies as "down" from
 * more than one reasonable reference point).
 */
export function detectIntradayDecline(
  sessionCandles: Candle[],
  prevClose: number,
  config: StrategyConfig["intradayDecline"]
): IntradayDeclineResult {
  if (sessionCandles.length === 0) {
    return { passed: false, declineFromOpenPct: 0, declineFromPrevClosePct: 0 };
  }
  const sessionOpen = sessionCandles[0].open;
  const currentPrice = sessionCandles[sessionCandles.length - 1].close;

  const declineFromOpenPct = (sessionOpen - currentPrice) / sessionOpen;
  const declineFromPrevClosePct = (prevClose - currentPrice) / prevClose;

  const passed =
    declineFromOpenPct >= config.minDeclineFromOpenPct ||
    declineFromPrevClosePct >= config.minDeclineFromPrevClosePct;

  return { passed, declineFromOpenPct, declineFromPrevClosePct };
}

export interface RecoveryFromLowResult {
  passed: boolean;
  sessionLow: number;
  currentPrice: number;
  dollarRecovery: number;
  pctRecovery: number;
}

/**
 * Stage 2: has price recovered a meaningful amount from the session low?
 * Supports both dollar and percentage thresholds since a fixed dollar move
 * behaves very differently on a $20 stock vs a $500 stock.
 */
export function detectRecoveryFromLow(
  sessionCandles: Candle[],
  config: StrategyConfig["recoveryFromLow"]
): RecoveryFromLowResult {
  if (sessionCandles.length === 0) {
    return { passed: false, sessionLow: 0, currentPrice: 0, dollarRecovery: 0, pctRecovery: 0 };
  }
  const sessionLow = Math.min(...sessionCandles.map((c) => c.low));
  const currentPrice = sessionCandles[sessionCandles.length - 1].close;

  const dollarRecovery = currentPrice - sessionLow;
  const pctRecovery = sessionLow === 0 ? 0 : dollarRecovery / sessionLow;

  const meetsDollar = dollarRecovery >= config.minDollarRecovery;
  const meetsPct = pctRecovery >= config.minPctRecovery;
  const passed = config.useEither ? meetsDollar || meetsPct : meetsDollar && meetsPct;

  return { passed, sessionLow, currentPrice, dollarRecovery, pctRecovery };
}
