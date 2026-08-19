import type { AttentionState, PendingAttentionTransition } from "@/lib/attention/attentionState";

const LABELS: Record<AttentionState, string> = {
  LOW_PRIORITY: "Low priority",
  WATCHING: "Watching",
  EMERGING: "Emerging",
  IN_PLAY: "In play",
  COOLING: "Cooling",
};

/** State is explanatory membership metadata; callers must order rows by score or velocity, never this badge. */
export function AttentionStateBadge({
  state,
  explanation,
  pendingTransition,
  pendingTransitionMinutes,
}: {
  state: AttentionState;
  explanation: string;
  pendingTransition: PendingAttentionTransition;
  pendingTransitionMinutes: number;
}) {
  return (
    <span data-attention-state={state} data-pending-transition={pendingTransition}>
      <strong>{LABELS[state]}</strong>
      {pendingTransition !== "none" && <span> · {pendingTransition} {pendingTransitionMinutes}m</span>}
      <span className="block text-xs text-platinum-dim">{explanation}</span>
    </span>
  );
}
