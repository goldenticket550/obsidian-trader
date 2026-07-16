"use client";

import { useState } from "react";
import type { SetupResult, ConditionState } from "@/types/setup";
import { buildTradingViewUrl } from "@/lib/tradingview";
import { SetupStageTimeline } from "./SetupStageTimeline";

const STATE_LABEL: Record<ConditionState, string> = {
  pass: "Pass",
  fail: "Fail",
  waiting: "Waiting",
  invalidated: "Invalidated",
};

const STATE_CLASS: Record<ConditionState, string> = {
  pass: "text-signal-green",
  fail: "text-signal-red",
  waiting: "text-signal-yellow",
  invalidated: "text-signal-red",
};

const STATUS_DOT_CLASS: Record<"red" | "yellow" | "green", string> = {
  red: "bg-signal-red",
  yellow: "bg-signal-yellow",
  green: "bg-signal-green",
};

export function SetupDetail({
  result,
  exchange,
  timeframe,
  onTimeframeChange,
}: {
  result: SetupResult | null;
  exchange: string;
  timeframe: "5m" | "15m";
  onTimeframeChange: (tf: "5m" | "15m") => void;
}) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  if (!result) {
    return (
      <section className="panel p-6 flex items-center justify-center text-platinum-dim text-sm">
        Select a symbol from the watchlist to see its checklist.
      </section>
    );
  }

  async function handleExplain() {
    setExplaining(true);
    setExplainError(null);
    setExplanation(null);

    const res = await fetch("/api/ai/explain-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: result!.symbol, timeframe: result!.timeframe, exchange }),
    });
    const json = await res.json();

    if (!res.ok) {
      setExplainError(json.error ?? "Failed to generate explanation");
      setExplaining(false);
      return;
    }

    setExplanation(json.explanation);
    setExplaining(false);
  }

  const tvUrl = buildTradingViewUrl(result.symbol, exchange, result.timeframe);

  return (
    <section className="panel">
      <div className="px-5 py-4 border-b border-obsidian-border flex items-center justify-between">
        <div>
          <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim">
            {result.symbol} — {result.timeframe} Setup
          </h2>
          <p className="text-xs text-platinum-dim mt-1">
            Stage: <span className="text-platinum">{result.stage.replace(/_/g, " ")}</span>
            {" · "}
            {result.quality === "simulated" ? "Simulated data" : result.quality}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded border border-obsidian-border overflow-hidden text-xs">
            {(["5m", "15m"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2.5 py-1 transition-colors ${
                  timeframe === tf
                    ? "bg-white/[0.08] text-platinum-bright"
                    : "text-platinum-dim hover:text-platinum"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          <a
            href={tvUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 border border-obsidian-border rounded text-platinum hover:border-platinum-dim transition-colors"
          >
            Open in TradingView ↗
          </a>
        </div>
      </div>

      <div className="px-5 py-4 border-b border-obsidian-border flex items-center gap-3">
        <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_CLASS[result.status]}`} />
        <span className="text-sm">
          Score <span className="font-mono text-platinum-bright">{result.score}</span> /{" "}
          {result.maxScore}
        </span>
        <span className="text-xs text-platinum-dim ml-auto">
          Updated {new Date(result.lastUpdated).toLocaleTimeString()}
        </span>
      </div>

      <SetupStageTimeline currentStage={result.stage} />

      <ul className="divide-y divide-obsidian-border/60 border-t border-obsidian-border">
        {result.conditions.map((c) => (
          <li key={c.id} className="px-5 py-3 flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-platinum-bright">
                {c.label}
                {!c.required && (
                  <span className="ml-2 text-[10px] uppercase text-platinum-dim">optional</span>
                )}
              </div>
              {c.detail && <div className="text-xs text-platinum-dim mt-0.5">{c.detail}</div>}
            </div>
            <span className={`text-xs font-mono shrink-0 ${STATE_CLASS[c.state]}`}>
              {STATE_LABEL[c.state]}
            </span>
          </li>
        ))}
      </ul>

      <div className="px-5 py-4 border-t border-obsidian-border">
        <button
          onClick={handleExplain}
          disabled={explaining}
          className="text-xs bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-50 border border-obsidian-border rounded px-3 py-1.5 text-platinum-bright transition-colors"
        >
          {explaining ? "Thinking…" : "Explain this setup (AI)"}
        </button>
        {explainError && <div className="text-xs text-signal-red mt-2">{explainError}</div>}
        {explanation && (
          <div className="mt-3 text-sm text-platinum-dim leading-relaxed border-l-2 border-obsidian-border pl-3">
            {explanation}
          </div>
        )}
      </div>

      <div className="px-5 py-3 text-[11px] text-platinum-dim border-t border-obsidian-border">
        A green status means this setup is ready for manual review — it is never a buy signal.
      </div>
    </section>
  );
}
