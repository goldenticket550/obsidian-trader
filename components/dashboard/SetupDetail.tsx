"use client";

import { useState } from "react";
import type { SetupResult, ConditionState, ConditionCategory, ConvictionLevel, EntryStatus } from "@/types/setup";
import { buildTradingViewUrl } from "@/lib/tradingview";
import { SetupStageTimeline } from "./SetupStageTimeline";
import { conditionExplanations } from "@/lib/strategies/conditionExplanations";

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

const STATUS_BORDER_CLASS: Record<"red" | "yellow" | "green", string> = {
  red: "border-l-signal-red",
  yellow: "border-l-signal-yellow",
  green: "border-l-signal-green",
};

const CATEGORY_ORDER: ConditionCategory[] = ["core", "secondary", "supporting", "informational"];
const CATEGORY_LABEL: Record<ConditionCategory, string> = {
  core: "Core Signals",
  secondary: "Secondary Confirmations",
  supporting: "Supporting Signals",
  informational: "Informational",
};
// Left-edge accent per category - a quiet visual cue for "how much this
// row should matter to you" that doesn't rely on reading every label.
const CATEGORY_BORDER_CLASS: Record<ConditionCategory, string> = {
  core: "border-l-platinum-bright",
  secondary: "border-l-platinum",
  supporting: "border-l-platinum-dim",
  informational: "border-l-obsidian-border",
};

const CONVICTION_LABEL: Record<ConvictionLevel, string> = {
  watch: "👀 WATCH",
  developing: "🔥 DEVELOPING",
  confirmed: "✅ CONFIRMED",
};

const CONVICTION_CLASS: Record<ConvictionLevel, string> = {
  watch: "bg-white/[0.06] text-platinum-dim border-obsidian-border",
  developing: "bg-signal-yellow/10 text-signal-yellow border-signal-yellow/30",
  confirmed: "bg-signal-green/10 text-signal-green border-signal-green/30",
};

const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  actionable_now: "Actionable Now",
  wait_for_pullback: "Wait For Pullback",
  extended_do_not_chase: "Extended — Do Not Chase",
  invalidated: "Invalidated",
};

const ENTRY_STATUS_CLASS: Record<EntryStatus, string> = {
  actionable_now: "bg-signal-green/10 text-signal-green border-signal-green/30",
  wait_for_pullback: "bg-signal-yellow/10 text-signal-yellow border-signal-yellow/30",
  extended_do_not_chase: "bg-signal-yellow/10 text-signal-yellow border-signal-yellow/30",
  invalidated: "bg-signal-red/10 text-signal-red border-signal-red/30",
};

function formatScanTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatCandleTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    conditions: result.conditions.filter((c) => (c.category ?? "supporting") === category),
  })).filter((g) => g.conditions.length > 0);

  return (
    <section className="panel overflow-hidden">
      {/* Header: ticker, stage, timeframe toggle, chart link */}
      <div className="px-6 py-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-display text-platinum-bright">
            {result.symbol} <span className="text-platinum-dim font-normal">· {result.timeframe} Setup</span>
          </h2>
          <p className="text-xs text-platinum-dim mt-1">
            Stage <span className="text-platinum">{result.stage.replace(/_/g, " ")}</span>
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
                className={`px-3 py-1.5 transition-colors ${
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

      {/* Summary card: score, conviction, entry status, and timestamps all
          together as one visually distinct "headline" block, with a left
          border colored by status - the single most important glance on
          this panel, so it gets the most visual weight. */}
      <div
        className={`mx-6 mb-5 rounded-lg border border-obsidian-border ${STATUS_BORDER_CLASS[result.status]} border-l-4 bg-white/[0.02] px-5 py-4`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT_CLASS[result.status]} mr-1`} />
              <span className="font-mono text-3xl text-platinum-bright leading-none">
                {result.score.toFixed(1)}
              </span>
              <span className="text-sm text-platinum-dim">/ 10</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {result.convictionLevel && (
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded border ${CONVICTION_CLASS[result.convictionLevel]}`}
                >
                  {CONVICTION_LABEL[result.convictionLevel]}
                </span>
              )}
              {result.entryStatus && (
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded border ${ENTRY_STATUS_CLASS[result.entryStatus]}`}
                >
                  {ENTRY_STATUS_LABEL[result.entryStatus]}
                </span>
              )}
            </div>
          </div>

          {/* Timestamps - moved out of the tiny corner text from before and
              given their own clearly labeled, readable row. */}
          <div className="text-xs text-platinum-dim space-y-0.5 text-right shrink-0">
            <div>
              <span className="text-platinum-dim/60">Scanned</span>{" "}
              <span className="text-platinum">{formatScanTime(result.lastUpdated)}</span>
            </div>
            {result.latestCandleTime && (
              <div>
                <span className="text-platinum-dim/60">Latest candle started</span>{" "}
                <span className="text-platinum">{formatCandleTime(result.latestCandleTime)}</span>
              </div>
            )}
          </div>
        </div>

        {result.invalidationNote && (
          <div className="mt-4 pt-4 border-t border-obsidian-border/60">
            <div className="text-[11px] uppercase tracking-wider text-platinum-dim mb-1">
              Invalidation Watch
            </div>
            <div className="text-xs text-platinum-dim">{result.invalidationNote}</div>
          </div>
        )}
      </div>

      <div className="px-1">
        <SetupStageTimeline currentStage={result.stage} />
      </div>

      {/* Checklist: grouped by category, each section with its own left
          accent color and generous spacing between rows so it doesn't
          read as one dense wall of text. */}
      <div className="border-t border-obsidian-border mt-2">
        {grouped.map((group) => (
          <div key={group.category} className="py-4 border-b border-obsidian-border/60 last:border-0">
            <div className="px-6 pb-3 text-[11px] font-medium uppercase tracking-wider text-platinum-dim">
              {CATEGORY_LABEL[group.category]}
            </div>
            <ul className="space-y-3 px-6">
              {group.conditions.map((c) => {
                const conditionInfo = conditionExplanations[c.id];
                const reasoning =
                  c.state === "pass" || c.state === "waiting"
                    ? conditionInfo?.whyItMatters
                    : conditionInfo?.whatItMeans ?? conditionInfo?.whyItMatters;
                const watchFor = c.state === "waiting" ? conditionInfo?.whatToWatchFor : undefined;

                return (
                  <li
                    key={c.id}
                    className={`rounded border-l-2 ${CATEGORY_BORDER_CLASS[group.category]} bg-white/[0.015] pl-4 pr-4 py-3`}
                  >
                    <div className="flex items-start justify-between gap-4">
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
                    </div>
                    {reasoning && (
                      <div className="text-xs text-platinum-dim mt-2 leading-relaxed opacity-70">
                        {reasoning}
                      </div>
                    )}
                    {watchFor && (
                      <div className="text-xs text-platinum-dim mt-1.5 italic opacity-50">{watchFor}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="px-6 py-5 border-t border-obsidian-border">
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

      <div className="px-6 py-3 text-[11px] text-platinum-dim border-t border-obsidian-border">
        A green status means this setup is ready for manual review — it is never a buy signal.
      </div>
    </section>
  );
}
