import type { SetupStage } from "@/types/setup";

const STAGE_ORDER: { id: SetupStage; label: string }[] = [
  { id: "intraday_decline", label: "Decline" },
  { id: "recovery_from_low", label: "Recovery" },
  { id: "consecutive_bullish", label: "Momentum" },
  { id: "liquidity_sweep", label: "Sweep" },
  { id: "structure_shift", label: "Structure" },
  { id: "ema_reclaim", label: "EMA Reclaim" },
  { id: "fair_value_gap", label: "FVG" },
  { id: "gap_proximity", label: "Gap Entry" },
];

export function SetupStageTimeline({ currentStage }: { currentStage: SetupStage }) {
  const currentIndex = STAGE_ORDER.findIndex((s) => s.id === currentStage);

  return (
    <div className="flex items-center overflow-x-auto px-5 py-4 gap-0">
      {STAGE_ORDER.map((stage, i) => {
        const reached = currentIndex >= 0 && i <= currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div key={stage.id} className="flex items-center shrink-0">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isCurrent
                    ? "bg-signal-green ring-4 ring-signal-green/20"
                    : reached
                    ? "bg-platinum"
                    : "bg-obsidian-border"
                }`}
              />
              <span
                className={`text-[10px] uppercase tracking-wide whitespace-nowrap ${
                  reached ? "text-platinum-bright" : "text-platinum-dim"
                }`}
              >
                {stage.label}
              </span>
            </div>
            {i < STAGE_ORDER.length - 1 && (
              <div
                className={`h-px w-8 mx-1 mb-4 ${reached ? "bg-platinum-dim" : "bg-obsidian-border"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
