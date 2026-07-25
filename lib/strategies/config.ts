/**
 * All thresholds for the Bullish Intraday Reclaim + Fair Value Gap strategy.
 * Nothing here is hard-coded into the detectors themselves — every detector
 * takes its config as a parameter, so this file is the single place to tune
 * the strategy, and you can eventually store per-symbol overrides in
 * `strategy_configs` (Supabase) without touching detector code.
 */
export interface StrategyConfig {
  intradayDecline: {
    /** e.g. 0.03 = 3% decline from session open counts as "significant" */
    minDeclineFromOpenPct: number;
    minDeclineFromPrevClosePct: number;
  };
  recoveryFromLow: {
    minDollarRecovery: number;
    minPctRecovery: number;
    /** if true, either dollar OR pct threshold passing is enough */
    useEither: boolean;
  };
  consecutiveBullish: {
    minCandles: number; // 2 or 3
    minBodySizeDollars: number;
    minTotalMoveDollars: number;
    requireHigherHighsLows: boolean;
  };
  liquiditySweep: {
    /** how many candles the sweep-and-reclaim must complete within */
    maxCandlesToReclaim: number;
    pivotLookback: number; // candles each side used to confirm a pivot low
  };
  structureShift: {
    pivotLength: number;
  };
  emaReclaim: {
    period: number; // 9
    requireFollowThroughCandle: boolean;
    requireRisingSlope: boolean;
    minPctAboveEma: number;
    minReclaimBodySizeDollars: number;
  };
  dailySma: {
    period: number; // 20
  };
  fairValueGap: {
    minGapSizeDollars: number;
    minGapSizePct: number;
  };
  gapProximity: {
    alertDistanceDollars: number;
    alertDistancePct: number;
  };
  volumeConfirmation: {
    minRelativeVolumePct: number; // e.g. 1.2 = 120% of average
  };
  strat: {
    /** award points for 2-2 reversal or inside-bar-into-reclaim patterns */
    enabled: boolean;
  };
  vwap: {
    enabled: boolean;
  };
  pressure: {
    minBodyPercent: number; // e.g. 0.6 = candle body is 60%+ of its range
    minRelativeVolume: number; // e.g. 1.5 = 150% of recent average volume
    lookback: number; // candles used to compute average volume for comparison
  };
  /**
   * Governs entryStatus (actionable now vs. wait for pullback vs.
   * extended-don't-chase). Extension is measured as price's distance
   * from the 9 EMA relative to ATR, not a raw percentage — this scales
   * naturally across low- and high-priced, low- and high-volatility
   * stocks instead of needing a different fixed dollar/percent per stock.
   */
  extension: {
    atrPeriod: number;
    /** distance beyond this many ATRs from the EMA counts as "extended" */
    extendedAtrMultiplier: number;
  };
}

export const defaultStrategyConfig: StrategyConfig = {
  intradayDecline: {
    minDeclineFromOpenPct: 0.02,
    minDeclineFromPrevClosePct: 0.02,
  },
  recoveryFromLow: {
    minDollarRecovery: 2,
    minPctRecovery: 0.01,
    useEither: true,
  },
  consecutiveBullish: {
    minCandles: 3,
    minBodySizeDollars: 0.05,
    minTotalMoveDollars: 0.5,
    requireHigherHighsLows: true,
  },
  liquiditySweep: {
    maxCandlesToReclaim: 3,
    pivotLookback: 3,
  },
  structureShift: {
    pivotLength: 3,
  },
  emaReclaim: {
    period: 9,
    requireFollowThroughCandle: false,
    requireRisingSlope: false,
    minPctAboveEma: 0,
    minReclaimBodySizeDollars: 0,
  },
  dailySma: {
    period: 20,
  },
  fairValueGap: {
    minGapSizeDollars: 0.1,
    minGapSizePct: 0.0005,
  },
  gapProximity: {
    alertDistanceDollars: 0.25,
    alertDistancePct: 0.002,
  },
  volumeConfirmation: {
    minRelativeVolumePct: 1.2,
  },
  strat: {
    enabled: true,
  },
  vwap: {
    enabled: true,
  },
  pressure: {
    minBodyPercent: 0.6,
    minRelativeVolume: 1.5,
    lookback: 20,
  },
  extension: {
    atrPeriod: 14,
    extendedAtrMultiplier: 1.5,
  },
};
