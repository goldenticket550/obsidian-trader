import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidateGenerationResult, LabelCandidate } from "./labelAssistant";
import type { EditableLabelField, GroundTruthLabel, LabelCandidateDecision, ReasonTag, SessionLabels } from "./types";

export interface LabelReview {
  tradingDate: string;
  quietSession: boolean | null;
  reviewCompleted: boolean;
  candidates: LabelCandidate[];
  labels: GroundTruthLabel[];
}

function candidateRow(candidate: LabelCandidate, userId: string) {
  return {
    id: candidate.id,
    user_id: userId,
    trading_date: candidate.tradingDate,
    symbol: candidate.symbol,
    rank: candidate.rank,
    decision: candidate.decision,
    selection_reasons: candidate.selectionReasons,
    range_atr: candidate.rangeAtr,
    max_window_travel_atr: candidate.maxWindowTravelAtr,
    became_interesting: candidate.time_it_became_interesting,
    actually_noticed: candidate.time_i_actually_noticed,
    direction: candidate.direction,
    reason_tags: candidate.reason_tags,
    edited_fields: candidate.editedFields,
    sparkline: candidate.sparkline,
    updated_at: new Date().toISOString(),
  };
}

function labelRow(label: GroundTruthLabel, tradingDate: string, userId: string) {
  if (!label.id) throw new Error("A persisted label requires an id.");
  return {
    id: label.id,
    user_id: userId,
    trading_date: tradingDate,
    symbol: label.symbol,
    became_interesting: label.time_it_became_interesting,
    actually_noticed: label.time_i_actually_noticed,
    actual_notice_confidence: label.actual_notice_confidence,
    direction: label.direction,
    reason_tags: label.reason_tags,
    note: label.note,
    source: label.source,
    selection_biased: label.selectionBiased,
    missed_by_candidate_generator: label.missedByCandidateGenerator,
    edited_fields: label.editedFields,
    updated_at: new Date().toISOString(),
  };
}

function mapCandidate(row: Record<string, unknown>): LabelCandidate {
  return {
    id: row.id as string,
    tradingDate: row.trading_date as string,
    symbol: row.symbol as string,
    rank: Number(row.rank),
    decision: row.decision as LabelCandidateDecision,
    selectionReasons: (row.selection_reasons ?? []) as LabelCandidate["selectionReasons"],
    rangeAtr: Number(row.range_atr),
    maxWindowTravelAtr: Number(row.max_window_travel_atr),
    time_it_became_interesting: row.became_interesting as string,
    time_i_actually_noticed: (row.actually_noticed as string | null) ?? null,
    direction: row.direction as LabelCandidate["direction"],
    reason_tags: (row.reason_tags ?? []) as ReasonTag[],
    editedFields: (row.edited_fields ?? []) as EditableLabelField[],
    sparkline: row.sparkline as LabelCandidate["sparkline"],
  };
}

function mapLabel(row: Record<string, unknown>): GroundTruthLabel {
  return {
    id: row.id as string,
    symbol: row.symbol as string,
    time_it_became_interesting: (row.became_interesting as string | null) ?? null,
    time_i_actually_noticed: (row.actually_noticed as string | null) ?? null,
    actual_notice_confidence: row.actual_notice_confidence as GroundTruthLabel["actual_notice_confidence"],
    direction: row.direction as GroundTruthLabel["direction"],
    reason_tags: (row.reason_tags ?? []) as ReasonTag[],
    note: (row.note as string) ?? "",
    source: row.source as GroundTruthLabel["source"],
    selectionBiased: Boolean(row.selection_biased),
    missedByCandidateGenerator: Boolean(row.missed_by_candidate_generator),
    editedFields: (row.edited_fields ?? []) as EditableLabelField[],
  };
}

export async function saveGeneratedLabelReview(
  supabase: SupabaseClient,
  userId: string,
  generation: CandidateGenerationResult,
  executedLabels: GroundTruthLabel[]
): Promise<void> {
  const now = new Date().toISOString();
  const { error: sessionError } = await supabase.from("replay_label_sessions").upsert({
    user_id: userId,
    trading_date: generation.tradingDate,
    generated_at: now,
    review_completed: false,
    updated_at: now,
  }, { onConflict: "user_id,trading_date" });
  if (sessionError) throw new Error(`Failed to save label session: ${sessionError.message}`);

  if (generation.candidates.length > 0) {
    const { error } = await supabase.from("replay_label_candidates")
      .upsert(generation.candidates.map((candidate) => candidateRow(candidate, userId)), { onConflict: "user_id,id", ignoreDuplicates: true });
    if (error) throw new Error(`Failed to save label candidates: ${error.message}`);
  }
  if (executedLabels.length > 0) {
    const { error } = await supabase.from("replay_ground_truth_labels")
      .upsert(executedLabels.map((label) => labelRow(label, generation.tradingDate, userId)), { onConflict: "user_id,id" });
    if (error) throw new Error(`Failed to save executed-trade labels: ${error.message}`);
  }
}

export async function getLabelReview(supabase: SupabaseClient, userId: string, tradingDate: string): Promise<LabelReview> {
  const [sessionResult, candidateResult, labelResult] = await Promise.all([
    supabase.from("replay_label_sessions").select("*").eq("user_id", userId).eq("trading_date", tradingDate).maybeSingle(),
    supabase.from("replay_label_candidates").select("*").eq("user_id", userId).eq("trading_date", tradingDate).order("rank"),
    supabase.from("replay_ground_truth_labels").select("*").eq("user_id", userId).eq("trading_date", tradingDate).order("created_at"),
  ]);
  if (sessionResult.error) throw new Error(`Failed to load label session: ${sessionResult.error.message}`);
  if (candidateResult.error) throw new Error(`Failed to load candidates: ${candidateResult.error.message}`);
  if (labelResult.error) throw new Error(`Failed to load labels: ${labelResult.error.message}`);
  return {
    tradingDate,
    quietSession: sessionResult.data ? (sessionResult.data.quiet_session as boolean | null) : null,
    reviewCompleted: sessionResult.data ? Boolean(sessionResult.data.review_completed) : false,
    candidates: (candidateResult.data ?? []).map((row) => mapCandidate(row as Record<string, unknown>)),
    labels: (labelResult.data ?? []).map((row) => mapLabel(row as Record<string, unknown>)),
  };
}
async function reopenLabelReview(supabase: SupabaseClient, userId: string, tradingDate: string): Promise<void> {
  const { error } = await supabase.from("replay_label_sessions")
    .update({ review_completed: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId).eq("trading_date", tradingDate);
  if (error) throw new Error(`Failed to reopen label review: ${error.message}`);
}


export interface CandidateAdjudication {
  decision?: LabelCandidateDecision;
  time_i_actually_noticed?: string | null;
  time_it_became_interesting?: string;
  direction?: "bullish" | "bearish";
  reason_tags?: ReasonTag[];
}

export async function adjudicateLabelCandidate(
  supabase: SupabaseClient,
  userId: string,
  candidateId: string,
  update: CandidateAdjudication
): Promise<void> {
  const { data, error } = await supabase.from("replay_label_candidates").select("*")
    .eq("user_id", userId).eq("id", candidateId).single();
  if (error) throw new Error(`Failed to find label candidate: ${error.message}`);
  const candidate = mapCandidate(data as Record<string, unknown>);
  const changed: EditableLabelField[] = [...candidate.editedFields];
  const mark = (field: EditableLabelField, changedValue: boolean) => {
    if (changedValue && !changed.includes(field)) changed.push(field);
  };
  mark("time_i_actually_noticed", update.time_i_actually_noticed !== undefined && update.time_i_actually_noticed !== candidate.time_i_actually_noticed);
  mark("time_it_became_interesting", update.time_it_became_interesting !== undefined && update.time_it_became_interesting !== candidate.time_it_became_interesting);
  mark("direction", update.direction !== undefined && update.direction !== candidate.direction);
  mark("reason_tags", update.reason_tags !== undefined && JSON.stringify(update.reason_tags) !== JSON.stringify(candidate.reason_tags));
  const next: LabelCandidate = {
    ...candidate,
    decision: update.decision ?? candidate.decision,
    time_i_actually_noticed: update.time_i_actually_noticed === undefined ? candidate.time_i_actually_noticed : update.time_i_actually_noticed,
    time_it_became_interesting: update.time_it_became_interesting ?? candidate.time_it_became_interesting,
    direction: update.direction ?? candidate.direction,
    reason_tags: update.reason_tags ?? candidate.reason_tags,
    editedFields: changed,
  };
  const { error: updateError } = await supabase.from("replay_label_candidates")
    .update(candidateRow(next, userId)).eq("user_id", userId).eq("id", candidateId);
  if (updateError) throw new Error(`Failed to persist candidate review: ${updateError.message}`);
  await reopenLabelReview(supabase, userId, next.tradingDate);

  if (next.decision === "accepted") {
    const label: GroundTruthLabel = {
      id: `candidate:${candidateId}`,
      symbol: next.symbol,
      time_it_became_interesting: next.time_it_became_interesting,
      time_i_actually_noticed: next.time_i_actually_noticed,
      actual_notice_confidence: next.time_i_actually_noticed ? "high" : "unknown",
      direction: next.direction,
      reason_tags: next.reason_tags,
      note: "Explicitly accepted by the trader from a movement-selected candidate.",
      source: "trader_adjudicated",
      selectionBiased: false,
      missedByCandidateGenerator: false,
      editedFields: next.editedFields,
    };
    const { error: labelError } = await supabase.from("replay_ground_truth_labels")
      .upsert(labelRow(label, next.tradingDate, userId), { onConflict: "user_id,id" });
    if (labelError) throw new Error(`Failed to save adjudicated label: ${labelError.message}`);
  } else {
    const { error: deleteError } = await supabase.from("replay_ground_truth_labels")
      .delete().eq("user_id", userId).eq("id", `candidate:${candidateId}`);
    if (deleteError) throw new Error(`Failed to remove rejected label: ${deleteError.message}`);
  }
}

export async function addMissedCandidateLabel(
  supabase: SupabaseClient,
  userId: string,
  tradingDate: string,
  input: { symbol: string; time_it_became_interesting: string | null; time_i_actually_noticed: string | null; direction: GroundTruthLabel["direction"]; reason_tags?: ReasonTag[] }
): Promise<void> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("A manually added label requires a symbol.");
  const label: GroundTruthLabel = {
    id: `manual:${tradingDate}:${symbol}`,
    symbol,
    time_it_became_interesting: input.time_it_became_interesting,
    time_i_actually_noticed: input.time_i_actually_noticed,
    actual_notice_confidence: input.time_i_actually_noticed ? "high" : "unknown",
    direction: input.direction,
    reason_tags: input.reason_tags ?? [],
    note: "Trader-added label not surfaced by the movement candidate generator.",
    source: "trader_adjudicated",
    selectionBiased: false,
    missedByCandidateGenerator: true,
    editedFields: ["time_it_became_interesting", "direction", "reason_tags", ...(input.time_i_actually_noticed ? ["time_i_actually_noticed" as const] : [])],
  };
  const { error } = await supabase.from("replay_ground_truth_labels")
    .upsert(labelRow(label, tradingDate, userId), { onConflict: "user_id,id" });
  if (error) throw new Error(`Failed to save missed-candidate label: ${error.message}`);
  await reopenLabelReview(supabase, userId, tradingDate);
}

export async function updateLabelSession(
  supabase: SupabaseClient,
  userId: string,
  tradingDate: string,
  update: { quietSession?: boolean; reviewCompleted?: boolean }
): Promise<void> {
  if (update.quietSession === undefined && update.reviewCompleted === undefined) throw new Error("No session decision supplied.");
  if (update.reviewCompleted) {
    const { count, error } = await supabase.from("replay_label_candidates").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("trading_date", tradingDate).eq("decision", "pending");
    if (error) throw new Error(`Failed to validate review completion: ${error.message}`);
    if ((count ?? 0) > 0) throw new Error("Cannot complete review while candidates remain pending.");
  }
  const row: Record<string, unknown> = { user_id: userId, trading_date: tradingDate, updated_at: new Date().toISOString() };
  if (update.quietSession !== undefined) row.quiet_session = update.quietSession;
  if (update.reviewCompleted !== undefined) row.review_completed = update.reviewCompleted;
  const { error } = await supabase.from("replay_label_sessions").upsert(row, { onConflict: "user_id,trading_date" });
  if (error) throw new Error(`Failed to save label-session progress: ${error.message}`);
}

export function reviewToSessionLabels(review: LabelReview): SessionLabels {
  const auto = review.candidates;
  return {
    tradingDate: review.tradingDate,
    quietSession: review.quietSession,
    reviewCompleted: review.reviewCompleted,
    reviewStats: {
      autoCandidates: auto.length,
      accepted: auto.filter((candidate) => candidate.decision === "accepted").length,
      rejected: auto.filter((candidate) => candidate.decision === "rejected").length,
      pending: auto.filter((candidate) => candidate.decision === "pending").length,
      manualAdds: review.labels.filter((label) => label.missedByCandidateGenerator).length,
    },
    labels: review.labels,
  };
}
