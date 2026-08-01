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
  /** Rule A — prior-day rejection, two independent tiers. */
  priorDayContinuation: {
    /** prior close at/below prior high × (1 − this) = "rejection" */
    rejectionThresholdPct: number;
    /** the deeper tier: at/below prior high × (1 − this) = "strong rejection" */
    strongRejectionThresholdPct: number;
  };
  /** Rule B — momentum milestone ladder. */
  momentumLadder: {
    /**
     * Percent tiers measured from the immutable session-open anchor.
     * UNVALIDATED DISPLAY DEFAULTS — deliberately not presented as a
     * validated strategy, per the rule table.
     */
    tiers: number[];
  };
  /** Rule D — benchmark/sector alignment. */
  benchmarkAlignment: {
    /** Used whenever a symbol has no explicit override below. */
    defaultBenchmark: string;
    /** Per-symbol overrides, e.g. semiconductor names -> SMH. */
    overrides: Record<string, string>;
  };
  /**
   * Premarket Expansion Candidate.
   *
   * NOTE: there is deliberately no rank/score here. The approved spec
   * removes Expansion Rank entirely and forbids replacing it with another
   * numerical score — evidence groups are presented as counts and states,
   * never blended into one number.
   */
  premarketExpansion: {
    /**
     * Whether the scanner evaluates the Premarket Expansion Candidate at
     * all. When false the historical baseline fetch, the benchmark
     * premarket/daily fetches and the detector are all skipped, so the
     * added provider load is opt-out-able without a code change.
     */
    enabled: boolean;
    /**
     * Whether the scanner also evaluates the ONE-MINUTE Expansion Monitor
     * layer — early acceleration, dollar-volume context, the momentum
     * ladder, and the two stages that need live impulse.
     *
     * Separate from `enabled` because it carries its own provider load: a
     * ~21-session 1-minute history per symbol. Turning it off leaves the
     * five-minute candidate working exactly as before.
     */
    monitorEnabled: boolean;
    /**
     * Width of the regular-session opening range, in minutes from 9:30.
     * An UNVALIDATED scanner default, not a validated level — the range is
     * only ever presented as a measured high/low, never as a prediction.
     */
    openingRangeMinutes: number;
    /** How many prior sessions the baseline medians are taken over. */
    lookbackSessions: number;
    /** Below this many ELIGIBLE sessions, volume/range baselines report insufficientData. */
    minBaselineSessions: number;
    /** Premarket must have run at least this long before a volume pace is computed. */
    minimumElapsedPremarketMinutes: number;
    /**
     * Operational noise floor for the baseline median cumulative volume —
     * NOT a validated trading threshold. Below it, a "pace" is a ratio of
     * two rounding errors.
     */
    minimumBaselineMedianVolume: number;
    /**
     * Half-width, in percentage points, of the "Approximately aligned"
     * band around zero relative performance. UNVALIDATED scanner default:
     * a quarter of a percentage point is inside ordinary premarket noise
     * for a large-cap against QQQ. The computed difference is always
     * displayed next to the label so this never has to be trusted alone.
     */
    alignedTolerancePct: number;
    /** Prior-level "approaching" tolerance; the LARGER of percent/ATR wins. */
    priorLevelApproachPercent: number;
    priorLevelApproachAtrFraction: number;
    /** Tighter band, inside which price is "Testing level" rather than approaching. */
    priorLevelTestingPercent: number;
    /**
     * Minimum completed premarket bars BEFORE the evaluation bar needed to
     * establish a reference range. One bar, or a zero-width range, is
     * insufficient data.
     */
    minReferenceBars: number;
    /** Range-position zone boundaries, in percent of the reference range. */
    rangeZoneUpperPct: number;
    rangeZoneLowerPct: number;
    /** `structure` group — pivot length used on premarket bars. */
    structurePivotLength: number;
    /**
     * Multiple of the baseline median that today's elapsed premarket volume
     * must reach for the participation group to pass. UNVALIDATED scanner
     * default — centralized here rather than inlined in the detector so it
     * is tunable and visible, not so it carries any statistical authority.
     */
    volumePaceMinMultiple: number;
    /** The same, for the session range against its baseline median. */
    rangeExpansionMinMultiple: number;
    /**
     * How many CONSECUTIVE completed confirmation closes beyond the frozen
     * level acceptance requires. Consecutive, not cumulative: a break, a
     * failed close back through, and a second break is two attempts.
     */
    requiredConsecutiveCloses: number;
    /** How many of the six evidence groups must pass. */
    minGroupsToQualify: number;
    /**
     * Freshness boundary, in candle intervals. A real-time feed's latest
     * completed bar may be at most this many intervals old (10 minutes on
     * 5m confirmation candles); beyond it the data is stale and blocks new
     * alerts. There is deliberately no undefined band above this.
     */
    freshnessIntervalAllowance: number;
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
  priorDayContinuation: {
    // 2% matches the intradayDecline convention already in production.
    rejectionThresholdPct: 0.02,
    strongRejectionThresholdPct: 0.05,
  },
  momentumLadder: {
    tiers: [3, 5, 8, 10, 15],
  },
  benchmarkAlignment: {
    defaultBenchmark: "QQQ",
    overrides: {},
  },
  premarketExpansion: {
    enabled: true,
    monitorEnabled: true,
    openingRangeMinutes: 15,
    lookbackSessions: 20,
    minBaselineSessions: 10,
    minimumElapsedPremarketMinutes: 15,
    minimumBaselineMedianVolume: 500,
    alignedTolerancePct: 0.25,
    // Unvalidated scanner defaults, not probabilities — the display
    // always shows the real distance alongside any "Approaching" label.
    priorLevelApproachPercent: 0.25,
    priorLevelApproachAtrFraction: 0.1,
    priorLevelTestingPercent: 0.05,
    minReferenceBars: 2,
    rangeZoneUpperPct: 75,
    rangeZoneLowerPct: 25,
    // Shorter than the 3 used on regular-session bars: premarket holds
    // far fewer candles, and a length-3 fractal needs 7 bars to confirm a
    // single pivot, which would leave the structure group unevaluatable
    // for most of the morning.
    structurePivotLength: 2,
    volumePaceMinMultiple: 1.5,
    rangeExpansionMinMultiple: 1.5,
    requiredConsecutiveCloses: 2,
    minGroupsToQualify: 3,
    freshnessIntervalAllowance: 2,
  },
};
