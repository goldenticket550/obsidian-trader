/**
 * Plain-English reasoning attached to every checklist condition. This is
 * deliberately NOT AI-generated — it's fixed, hand-written content per
 * condition type, so it's instant, free, and always available regardless
 * of whether AI is configured. The goal is a checklist that explains
 * *why* each line matters, not just whether it passed, so the score
 * feels earned rather than opaque.
 *
 * This never says "this means buy" or predicts direction — it explains
 * the mechanical reasoning behind the rule, same guardrail the AI layer
 * follows.
 */
export interface ConditionExplanation {
  /** Always true, regardless of pass/fail/waiting — the underlying "why." */
  whyItMatters: string;
  /** Shown specifically when the condition is still waiting. */
  whatToWatchFor?: string;
  /** Shown specifically when the condition has failed or been invalidated. */
  whatItMeans?: string;
}

export const conditionExplanations: Record<string, ConditionExplanation> = {
  intraday_decline: {
    whyItMatters:
      "This setup is built around stocks that sold off and then recovered — without a real decline first, there's nothing for the rest of the checklist to be recovering from.",
    whatItMeans:
      "No meaningful decline happened, so this isn't the kind of reversal setup this strategy is built to find — not necessarily a weak stock, just not this pattern.",
  },
  recovery_from_low: {
    whyItMatters:
      "A genuine bounce off the low is the first real evidence that sellers are losing control and buyers are stepping in — without it, the stock could just as easily keep making new lows.",
    whatToWatchFor:
      "Watching for price to move a meaningful distance off the session low, not just a small tick.",
  },
  consecutive_bullish: {
    whyItMatters:
      "Several bullish candles in a row shows the recovery has some follow-through, not just a single spike that could reverse immediately. This is momentum evidence, not proof the move continues — three big green candles can also mean price is already extended.",
    whatToWatchFor:
      "Watching for the next couple candles to keep closing higher, with real bodies (not just small indecisive candles).",
  },
  liquidity_sweep: {
    whyItMatters:
      "A sweep-and-reclaim below a prior low often means the last sellers got shaken out right before buyers took over. Marked experimental because this pattern is harder to define objectively than the others in this checklist.",
    whatToWatchFor: "Watching for price to dip below a recent low and then close back above it within a few candles.",
  },
  structure_shift: {
    whyItMatters:
      "A close above the prior swing high is real, confirmed evidence that short-term control has flipped from sellers to buyers — one of the higher-weight, more objective signals in this checklist.",
    whatToWatchFor: "Watching for a candle to close above the identified swing high — not just touch it intrabar.",
  },
  ema_reclaim: {
    whyItMatters:
      "The 9 EMA is a fast-moving average — reclaiming it means very recent buying is, on average, outpacing recent selling. A short-term trend signal, not a guarantee the trend holds.",
    whatToWatchFor: "Watching for price to close back above the 9 EMA after trading below it.",
  },
  fair_value_gap: {
    whyItMatters:
      "A fair value gap marks a price range that moved so fast it left little trading behind — some traders watch these as places price is statistically more likely to revisit before continuing.",
    whatToWatchFor: "Watching for three consecutive candles where the third candle's low sits above the first candle's high.",
  },
  gap_proximity: {
    whyItMatters:
      "Even a valid gap only matters once price actually approaches it — this tracks whether price has come back into a range worth paying attention to, not whether it will react there.",
  },
  volume_confirmation: {
    whyItMatters:
      "Above-average volume on the move suggests more real participation behind it, not just a handful of trades pushing price around on light activity. Optional — never required for a green status.",
  },
  daily_sma_confirmation: {
    whyItMatters:
      "The daily 20 SMA reflects the broader, slower trend — being above it adds context that the bigger picture is constructive too, not just the fast intraday move. Optional, never required.",
  },
  strat_confirmation: {
    whyItMatters:
      "Certain candle-to-candle patterns (like a directional reversal or an inside bar breaking out) are sometimes used as extra confirmation that a shift is real rather than noise. Optional, never required.",
  },
  vwap_reclaim: {
    whyItMatters:
      "VWAP is the average price weighted by how much volume traded at each level — many active traders and algorithms watch it as a real-time fair-value reference. Reclaiming it adds another independent vote that buyers are back in control. Optional, never required.",
    whatToWatchFor: "Watching for price to close back above session VWAP after trading below it.",
  },
};
