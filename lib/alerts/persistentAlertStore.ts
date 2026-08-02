import type { SupabaseClient } from "@supabase/supabase-js";
import type { SetupResult } from "@/types/setup";
import type { AlertEvent, AlertRule } from "./types";
import { evaluateAlerts } from "./alertEngine";

function toAlertEvent(row: Record<string, unknown>): AlertEvent {
  return {
    id: row.id as string,
    ruleId: row.rule_id as string,
    type: row.alert_type as AlertEvent["type"],
    symbol: row.symbol as string,
    timeframe: row.timeframe as AlertEvent["timeframe"],
    message: row.message as string,
    firedAt: row.fired_at as string,
  };
}

async function getSnapshot(
  supabase: SupabaseClient,
  userId: string,
  symbol: string,
  timeframe: string
): Promise<SetupResult | null> {
  const { data, error } = await supabase
    .from("scan_snapshots")
    .select("result")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .eq("timeframe", timeframe)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch scan snapshot: ${error.message}`);
  return data ? (data.result as SetupResult) : null;
}

async function saveSnapshot(
  supabase: SupabaseClient,
  userId: string,
  symbol: string,
  timeframe: string,
  result: SetupResult,
  now: Date
): Promise<void> {
  // `updated_at` is set explicitly rather than left to the column
  // default. A DEFAULT only fires on INSERT, so before this the column
  // recorded first-insert time and then froze, while its name promised
  // last-write time -- a snapshot rewritten every 60s could read hours
  // stale. Migration 0007 adds a BEFORE UPDATE trigger that enforces the
  // same thing at the database level for every writer; this explicit set
  // makes the value correct immediately, without depending on the
  // migration having been applied yet.
  const { error } = await supabase
    .from("scan_snapshots")
    .upsert(
      { user_id: userId, symbol, timeframe, result, updated_at: now.toISOString() },
      { onConflict: "user_id,symbol,timeframe" }
    );

  if (error) throw new Error(`Failed to save scan snapshot: ${error.message}`);
}

async function isOnCooldown(
  supabase: SupabaseClient,
  userId: string,
  event: AlertEvent,
  cooldownMs: number,
  now: Date
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - cooldownMs).toISOString();

  const { data, error } = await supabase
    .from("alert_events")
    .select("id")
    .eq("user_id", userId)
    .eq("rule_id", event.ruleId)
    .eq("symbol", event.symbol)
    .eq("timeframe", event.timeframe)
    .gte("fired_at", cutoff)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to check alert cooldown: ${error.message}`);
  return !!data;
}

async function recordEvent(
  supabase: SupabaseClient,
  userId: string,
  event: AlertEvent
): Promise<void> {
  const { error } = await supabase.from("alert_events").insert({
    user_id: userId,
    rule_id: event.ruleId,
    alert_type: event.type,
    symbol: event.symbol,
    timeframe: event.timeframe,
    message: event.message,
    fired_at: event.firedAt,
  });

  if (error) throw new Error(`Failed to record alert event: ${error.message}`);
}

/**
 * The persistent equivalent of Phase 5's AlertStore.processResult(): diffs
 * the new result against the last saved snapshot, evaluates alert rules,
 * checks each candidate against real cooldown history in the database,
 * records whatever survives, and saves the new snapshot for next time.
 * Works correctly regardless of whether this runs in a long-lived dev
 * server or a fresh serverless container that's never seen this user
 * before.
 */
export async function processResultPersistent(
  supabase: SupabaseClient,
  userId: string,
  result: SetupResult,
  rules: AlertRule[],
  now: Date = new Date()
): Promise<AlertEvent[]> {
  const previous = await getSnapshot(supabase, userId, result.symbol, result.timeframe);
  const nowIso = now.toISOString();

  const candidates = evaluateAlerts(previous, result, rules, nowIso);
  const surviving = await recordCandidatesPersistent(supabase, userId, candidates, rules, now);

  await saveSnapshot(supabase, userId, result.symbol, result.timeframe, result, now);

  return surviving;
}

/**
 * The cooldown-and-record half of `processResultPersistent`, for callers
 * that produced their own candidates.
 *
 * Extracted rather than duplicated so a second setup type cannot drift
 * into slightly different dedup or persistence behaviour: every alert in
 * this app, whatever produced it, passes through exactly these lines.
 *
 * `evaluateAlerts` is deliberately NOT part of this — it diffs a
 * SetupResult, which only the reversal scanner produces.
 */
export async function recordCandidatesPersistent(
  supabase: SupabaseClient,
  userId: string,
  candidates: AlertEvent[],
  rules: AlertRule[],
  now: Date = new Date()
): Promise<AlertEvent[]> {
  const surviving: AlertEvent[] = [];
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  for (const candidate of candidates) {
    const rule = ruleById.get(candidate.ruleId);
    const cooldownMs = rule?.cooldownMs ?? 0;

    const onCooldown = await isOnCooldown(supabase, userId, candidate, cooldownMs, now);
    if (onCooldown) continue;

    await recordEvent(supabase, userId, candidate);
    surviving.push(candidate);
  }

  return surviving;
}

export async function getRecentAlertEvents(
  supabase: SupabaseClient,
  userId: string,
  limit = 100
): Promise<AlertEvent[]> {
  const { data, error } = await supabase
    .from("alert_events")
    .select("*")
    .eq("user_id", userId)
    .order("fired_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch alert events: ${error.message}`);
  return (data ?? []).map(toAlertEvent);
}
