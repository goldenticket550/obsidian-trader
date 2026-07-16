import type { SetupResult } from "@/types/setup";
import type { JournalEntry } from "@/types/journal";
import type { JournalStatistics } from "@/lib/journal/statistics";
import type { AccountabilityChecks } from "@/types/watchlist";
import type { RiskSettings } from "@/types/risk";

/**
 * Shared constraints for every AI prompt in this app, directly reflecting
 * the "AI responsibilities" section of the original spec. Every prompt
 * builder below appends its specific task to this base — the guardrails
 * are never optional or task-specific, they apply everywhere the AI
 * layer touches this tool.
 */
const SAFETY_BASE = `You are an assistant embedded in a personal trading tool called Obsidian Trader. This tool is a setup scanner, accountability coach, and trading journal — it is explicitly NOT an automated trading bot and never places trades.

You will be given data that was already calculated by deterministic code (a rule engine). Your only job is to explain that data in plain, clear English. You must follow these rules without exception:

- Never calculate, estimate, or invent any price, indicator, or technical value yourself. Only reference the exact values you are given.
- Never predict future price direction or claim to know what will happen next.
- Never call a setup a "buy" or "sell" signal, and never recommend entering, exiting, or sizing a trade. A "green" or high-scoring setup means "ready for manual review by the user," nothing more.
- Never encourage increasing position size, revenge trading, or overriding the user's own configured risk limits.
- If the data shows a setup is weak, incomplete, or invalidated, say so plainly. Do not soften bad news into false encouragement, and do not manufacture urgency.
- If you are not confident about something based on the given data, say you're not sure rather than guessing.
- Keep responses concise and in plain English — this is read by a person making their own trading decisions, not a technical audience.`;

export function buildExplainSetupPrompt(result: SetupResult): { system: string; user: string } {
  const system = `${SAFETY_BASE}\n\nTask: explain why this setup is at its current stage, and what specifically is still missing before it would be fully confirmed. Reference the actual condition labels and details given.`;

  const conditionLines = result.conditions
    .map((c) => `- ${c.label}: ${c.state}${c.detail ? ` (${c.detail})` : ""}`)
    .join("\n");

  const user = `Symbol: ${result.symbol}
Timeframe: ${result.timeframe}
Data quality: ${result.quality}
Current stage: ${result.stage}
Status: ${result.status}
Score: ${result.score}/${result.maxScore}

Conditions:
${conditionLines || "(none evaluated)"}

Explain in 2-4 short sentences why this setup is where it is, and what would need to happen for it to progress. Do not recommend a trade.`;

  return { system, user };
}

export function buildEndOfDaySummaryPrompt(
  entries: JournalEntry[],
  stats: JournalStatistics,
  date: string
): { system: string; user: string } {
  const system = `${SAFETY_BASE}\n\nTask: summarize the user's trading day from their own logged journal entries. Reference only what they actually wrote — do not infer emotions, causes, or patterns they didn't state themselves.`;

  const entryLines = entries
    .map(
      (e) =>
        `- ${e.symbol} ${e.direction}, entry $${e.entryPrice}${e.exitPrice ? ` -> exit $${e.exitPrice}` : ""}, P&L $${e.profitLoss}, followed plan: ${e.followedPlan}${e.mistakeCategory ? `, mistake: ${e.mistakeCategory}` : ""}${e.lessonLearned ? `, lesson: "${e.lessonLearned}"` : ""}`
    )
    .join("\n");

  const user = `Date: ${date}
Total trades: ${stats.totalTrades}
Win rate: ${(stats.winRate * 100).toFixed(0)}%
Total P&L: $${stats.totalPnl.toFixed(2)}
Plan-following rate: ${(stats.planFollowingRate * 100).toFixed(0)}%

Entries:
${entryLines || "(no entries)"}

Write a short (3-5 sentence) end-of-day summary a trader could read before tomorrow's session.`;

  return { system, user };
}

const MIN_ENTRIES_FOR_PATTERN_ANALYSIS = 10;

export function hasEnoughDataForPatternAnalysis(entryCount: number): boolean {
  return entryCount >= MIN_ENTRIES_FOR_PATTERN_ANALYSIS;
}

export function buildPatternAnalysisPrompt(
  entries: JournalEntry[],
  stats: JournalStatistics
): { system: string; user: string } {
  const system = `${SAFETY_BASE}\n\nTask: identify behavioral patterns across the user's journal entries — for example, recurring mistake categories, whether certain emotional states correlate with worse outcomes in their own data, or whether departures from their plan tend to lose money. Only state patterns that are actually visible in the data provided. Do not speculate beyond it.`;

  const entryLines = entries
    .map(
      (e) =>
        `- ${e.tradeDate}, ${e.symbol}, P&L $${e.profitLoss}, followed plan: ${e.followedPlan}, emotional state: ${e.emotionalState ?? "not recorded"}, mistake: ${e.mistakeCategory ?? "none recorded"}`
    )
    .join("\n");

  const mistakeSummary = Object.entries(stats.mistakeCounts)
    .map(([category, count]) => `${category}: ${count}`)
    .join(", ");

  const user = `Total trades: ${stats.totalTrades}
Win rate: ${(stats.winRate * 100).toFixed(0)}%
Plan-following rate: ${(stats.planFollowingRate * 100).toFixed(0)}%
Mistake category counts: ${mistakeSummary || "none recorded"}

All entries:
${entryLines}

Identify 2-4 real patterns visible in this specific data. For each, state the pattern and the evidence for it from the data above.`;

  return { system, user };
}

export function buildAccountabilityReminderPrompt(
  checks: AccountabilityChecks,
  settings: RiskSettings
): { system: string; user: string } {
  const system = `${SAFETY_BASE}\n\nTask: turn the already-computed accountability warnings below into a short, firm-but-respectful reminder, in the spirit of messages like "Your daily loss limit has been reached" or "This setup does not meet your minimum score." You are rephrasing facts that have already been determined by the app's own rules — you are not deciding whether the user should be blocked from trading; that has already been decided.`;

  const activeWarnings: string[] = [];
  if (checks.blockedFromTrading) activeWarnings.push("Trading is currently blocked for today.");
  if (checks.dailyGoalReached) activeWarnings.push("Daily profit target has been reached.");
  if (checks.dailyLossLimitReached) activeWarnings.push("Daily loss limit has been reached.");
  if (checks.tradesRemaining === 0) activeWarnings.push("No trades remaining today.");
  if (checks.attemptingLowScoringSetup)
    activeWarnings.push("Currently viewing a setup below the minimum score.");
  if (checks.tradingTooCloseTogether) activeWarnings.push("Last trade was very recent.");
  if (checks.outsideAllowedSession) activeWarnings.push("Currently outside the allowed trading session.");

  const user = `Trades remaining: ${checks.tradesRemaining}/${settings.maxTradesPerDay}
Max risk per trade: $${checks.maxAllowedRisk}

Active conditions:
${activeWarnings.length > 0 ? activeWarnings.join("\n") : "None — everything looks normal."}

Write one short reminder (1-2 sentences). If there are no active conditions, write a brief, low-key confirmation that things look normal — don't invent urgency where none exists.`;

  return { system, user };
}
