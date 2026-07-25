import type { SupabaseClient } from "@supabase/supabase-js";
import type { RiskSettings, DailyTradingStatus } from "@/types/risk";
import { defaultRiskSettings, clampMinSetupScore, validateMinSetupScore } from "./defaults";
import { getCurrentTradingDate } from "./tradingDate";

function toRiskSettings(row: Record<string, unknown>): RiskSettings {
  return {
    maxTradesPerDay: row.max_trades_per_day as number,
    maxLossPerDay: Number(row.max_loss_per_day),
    dailyProfitTarget: Number(row.daily_profit_target),
    maxRiskPerTrade: Number(row.max_risk_per_trade),
    minSetupScore: clampMinSetupScore(row.min_setup_score as number),
    minMinutesBetweenTrades: row.min_minutes_between_trades as number,
    allowedSessions: row.allowed_sessions as RiskSettings["allowedSessions"],
    blockAfterTarget: row.block_after_target as boolean,
    blockAfterLossLimit: row.block_after_loss_limit as boolean,
  };
}

function toDbRow(settings: RiskSettings, userId: string) {
  return {
    user_id: userId,
    max_trades_per_day: settings.maxTradesPerDay,
    max_loss_per_day: settings.maxLossPerDay,
    daily_profit_target: settings.dailyProfitTarget,
    max_risk_per_trade: settings.maxRiskPerTrade,
    min_setup_score: settings.minSetupScore,
    min_minutes_between_trades: settings.minMinutesBetweenTrades,
    allowed_sessions: settings.allowedSessions,
    block_after_target: settings.blockAfterTarget,
    block_after_loss_limit: settings.blockAfterLossLimit,
  };
}

export async function getRiskSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<RiskSettings> {
  const { data, error } = await supabase
    .from("risk_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch risk settings: ${error.message}`);
  if (!data) return defaultRiskSettings;
  return toRiskSettings(data);
}

export async function upsertRiskSettings(
  supabase: SupabaseClient,
  userId: string,
  settings: RiskSettings
): Promise<void> {
  // Validate/clamp before writing - rejects NaN outright (a real client
  // bug worth surfacing) and clamps any out-of-range value into 0-10, so
  // it's impossible to ever save a value that would permanently fail the
  // "minimum score" accountability check.
  const validated: RiskSettings = {
    ...settings,
    minSetupScore: validateMinSetupScore(settings.minSetupScore),
  };

  const { error } = await supabase
    .from("risk_settings")
    .upsert(toDbRow(validated, userId), { onConflict: "user_id" });

  if (error) throw new Error(`Failed to save risk settings: ${error.message}`);
}

function toDailyStatus(row: Record<string, unknown>): DailyTradingStatus {
  return {
    tradeDate: row.trade_date as string,
    tradesTaken: row.trades_taken as number,
    realizedPnl: Number(row.realized_pnl),
    lastTradeAt: (row.last_trade_at as string | null) ?? null,
  };
}

/**
 * Fetches today's trading status, creating a fresh (zeroed) row if
 * today's trading date doesn't have one yet. This is what makes the
 * daily counters actually reset each day — there's no separate "reset"
 * job, a new day just means no row exists yet, so we create one at
 * zero.
 */
export async function getOrCreateTodayStatus(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<DailyTradingStatus> {
  const tradeDate = getCurrentTradingDate(now);

  const { data: existing, error: fetchError } = await supabase
    .from("daily_trading_status")
    .select("*")
    .eq("user_id", userId)
    .eq("trade_date", tradeDate)
    .maybeSingle();

  if (fetchError) throw new Error(`Failed to fetch daily status: ${fetchError.message}`);
  if (existing) return toDailyStatus(existing);

  const { data: created, error: insertError } = await supabase
    .from("daily_trading_status")
    .insert({ user_id: userId, trade_date: tradeDate, trades_taken: 0, realized_pnl: 0 })
    .select("*")
    .single();

  if (insertError) throw new Error(`Failed to create daily status: ${insertError.message}`);
  return toDailyStatus(created);
}

/**
 * Logs a trade: increments today's trade count and adds a P&L delta.
 * This is a deliberately lightweight stand-in for the full trade journal
 * (Phase 6c) — it tracks just enough to make the accountability panel
 * real (trade count, running P&L, time of last trade) without a full
 * entry/exit/notes form. Once the journal exists, this becomes an
 * aggregate computed from real journal entries instead of an
 * independently-tracked counter.
 */
/**
 * @deprecated No longer called from any route. This was the Phase 6b
 * "Log Trade" widget's write path — superseded by
 * recomputeDailyStatusFromJournal() in lib/journal/queries.ts, which
 * derives daily status from real journal entries instead of an
 * independently-tracked counter. Left here (not deleted) since the
 * logic itself is still correct and harmless, but nothing should call
 * this going forward — doing so would create a second, competing write
 * path to daily_trading_status.
 */
export async function logTrade(
  supabase: SupabaseClient,
  userId: string,
  pnlDelta: number,
  now: Date = new Date()
): Promise<DailyTradingStatus> {
  const current = await getOrCreateTodayStatus(supabase, userId, now);
  const tradeDate = getCurrentTradingDate(now);

  const { data, error } = await supabase
    .from("daily_trading_status")
    .update({
      trades_taken: current.tradesTaken + 1,
      realized_pnl: current.realizedPnl + pnlDelta,
      last_trade_at: now.toISOString(),
    })
    .eq("user_id", userId)
    .eq("trade_date", tradeDate)
    .select("*")
    .single();

  if (error) throw new Error(`Failed to log trade: ${error.message}`);
  return toDailyStatus(data);
}
