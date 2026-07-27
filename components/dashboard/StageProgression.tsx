"use client";

import { buildStageProgression, type StageState } from "@/lib/scanner/stageProgression";
import type { SetupStage } from "@/types/setup";

const DOT_CLASS: Record<StageState, string> = {
  completed: "bg-accent-emerald",
  current: "bg-accent-champagne",
  pending: "bg-obsidian-border",
  invalidated: "bg-signal-red",
};

const TEXT_CLASS: Record<StageState, string> = {
  completed: "text-accent-emerald",
  current: "text-accent-champagne",
  pending: "text-platinum-dim",
  invalidated: "text-signal-red",
};

export function StageProgression({
  stage,
  score,
  scoreThreshold,
  invalidated,
}: {
  stage: SetupStage;
  score: number;
  scoreThreshold: number;
  invalidated: boolean;
}) {
  const nodes = buildStageProgression(stage, score, scoreThreshold, invalidated);

  return (
    <div>
      <ol className="flex items-start gap-1" aria-label="Setup stage progression">
        {nodes.map((node, i) => (
          <li key={node.key} className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${DOT_CLASS[node.state]}`}
                aria-hidden="true"
              />
              {i < nodes.length - 1 && (
                <span
                  className={`h-px flex-1 ${
                    node.state === "completed" ? "bg-accent-emerald/40" : "bg-obsidian-border"
                  }`}
                  aria-hidden="true"
                />
              )}
            </div>
            <div className={`text-[10px] mt-1.5 leading-tight ${TEXT_CLASS[node.state]}`}>
              {node.label}
              <span className="sr-only"> — {node.state}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-[10px] text-platinum-dim mt-2">
        Score qualified reflects the score meeting your configured minimum of{" "}
        {scoreThreshold.toFixed(1)}, not the setup stage alone.
      </p>
    </div>
  );
}
