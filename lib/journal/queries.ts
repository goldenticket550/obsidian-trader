import type { SupabaseClient } from "@supabase/supabase-js";
import type { JournalEntry, NewJournalEntry } from "@/types/journal";

function toJournalEntry(row: Record<string, unknown>): JournalEntry {
  return {
    id: row.id as string,
    tradeDate: row.trade_date as string,
    symbol: row.symbol as string,
    direction: row.direction as JournalEntry["direction"],
    entryPrice: Number(row.entry_price),
    exitPrice: row.exit_price !== null ? Number(row.exit_price) : null,
    positionSize: Number(row.position_size),
    stopLoss: row.stop_loss !== null ? Number(row.stop_loss) : null,
    profitLoss: Number(row.profit_loss),
    setupScoreAtEntry: (row.setup_score_at_entry as number | null) ?? null,
    conditionsPassed: (row.conditions_passed as string[]) ?? [],
    conditionsMissing: (row.conditions_missing as string[]) ?? [],
    screenshotUrl: (row.screenshot_url as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    emotionalState: (row.emotional_state as string | null) ?? null,
    followedPlan: row.followed_plan as boolean,
    mistakeCategory: (row.mistake_category as string | null) ?? null,
    lessonLearned: (row.lesson_learned as string | null) ?? null,
    tags: (row.tags as string[]) ?? [],
    createdAt: row.created_at as string,
  };
}

function toDbRow(entry: NewJournalEntry, userId: string) {
  return {
    user_id: userId,
    trade_date: entry.tradeDate,
    symbol: entry.symbol.toUpperCase(),
    direction: entry.direction,
    entry_price: entry.entryPrice,
    exit_price: entry.exitPrice,
    position_size: entry.positionSize,
    stop_loss: entry.stopLoss,
    profit_loss: entry.profitLoss,
    setup_score_at_entry: entry.setupScoreAtEntry,
    conditions_passed: entry.conditionsPassed,
    conditions_missing: entry.conditionsMissing,
    screenshot_url: entry.screenshotUrl,
    notes: entry.notes,
    emotional_state: entry.emotionalState,
    followed_plan: entry.followedPlan,
    mistake_category: entry.mistakeCategory,
    lesson_learned: entry.lessonLearned,
    tags: entry.tags,
  };
}

export async function listJournalEntries(
  supabase: SupabaseClient,
  userId: string,
  limit = 200
): Promise<JournalEntry[]> {
  const { data, error } = await supabase
    .from("trade_journal_entries")
    .select("*")
    .eq("user_id", userId)
    .order("trade_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch journal entries: ${error.message}`);
  return (data ?? []).map(toJournalEntry);
}

export async function createJournalEntry(
  supabase: SupabaseClient,
  userId: string,
  entry: NewJournalEntry
): Promise<JournalEntry> {
  const { data, error } = await supabase
    .from("trade_journal_entries")
    .insert(toDbRow(entry, userId))
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create journal entry: ${error.message}`);

  await recomputeDailyStatusFromJournal(supabase, userId, entry.tradeDate);

  return toJournalEntry(data);
}

export async function deleteJournalEntry(
  supabase: SupabaseClient,
  userId: string,
  entryId: string
): Promise<void> {
  const { data: entry, error: fetchError } = await supabase
    .from("trade_journal_entries")
    .select("trade_date")
    .eq("id", entryId)
    .eq("user_id", userId)
    .single();

  if (fetchError) throw new Error(`Failed to find journal entry: ${fetchError.message}`);

  const { error: deleteError } = await supabase
    .from("trade_journal_entries")
    .delete()
    .eq("id", entryId)
    .eq("user_id", userId);

  if (deleteError) throw new Error(`Failed to delete journal entry: ${deleteError.message}`);

  await recomputeDailyStatusFromJournal(supabase, userId, entry.trade_date as string);
}

/**
 * Recomputes `daily_trading_status.trades_taken` / `realized_pnl` for a
 * given trading date as a true aggregate over that day's journal
 * entries, rather than the Phase 6b "increment a counter" approach. This
 * is the change the Phase 6b README promised: once real trade records
 * exist, daily status becomes derived data, not independently tracked —
 * which also means it self-corrects if an entry is edited or deleted,
 * something a simple running counter could never do.
 */
export async function recomputeDailyStatusFromJournal(
  supabase: SupabaseClient,
  userId: string,
  tradeDate: string
): Promise<void> {
  const { data: entries, error: fetchError } = await supabase
    .from("trade_journal_entries")
    .select("profit_loss, created_at")
    .eq("user_id", userId)
    .eq("trade_date", tradeDate);

  if (fetchError) {
    throw new Error(`Failed to recompute daily status: ${fetchError.message}`);
  }

  const rows = entries ?? [];
  const tradesTaken = rows.length;
  const realizedPnl = rows.reduce((sum, r) => sum + Number(r.profit_loss), 0);
  const lastTradeAt =
    rows.length > 0
      ? rows.reduce((latest: string, r) => {
          const createdAt = r.created_at as string;
          return createdAt > latest ? createdAt : latest;
        }, rows[0].created_at as string)
      : null;

  const { error: upsertError } = await supabase.from("daily_trading_status").upsert(
    {
      user_id: userId,
      trade_date: tradeDate,
      trades_taken: tradesTaken,
      realized_pnl: realizedPnl,
      last_trade_at: lastTradeAt,
    },
    { onConflict: "user_id,trade_date" }
  );

  if (upsertError) {
    throw new Error(`Failed to save recomputed daily status: ${upsertError.message}`);
  }
}
