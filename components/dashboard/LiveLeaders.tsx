"use client";

import { useMemo } from "react";
import type { SymbolExpansion } from "@/lib/scanner/scanService";
import type { SymbolExpansionMonitor } from "@/lib/scanner/expansionMonitor";
import {
  buildExpansionLeaders,
  expansionStageLabel,
  expansionTone,
  type ExpansionLeader,
} from "@/lib/scanner/expansionPresentation";

function money(value: number | null): string {
  return value === null ? "Unavailable" : `$${value.toFixed(2)}`;
}

function signedMoney(value: number | null): string {
  if (value === null) return "Unavailable";
  return `${value >= 0 ? "+" : "−"}$${Math.abs(value).toFixed(2)}`;
}

function signedPct(value: number | null): string {
  if (value === null) return "Unavailable";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
}

function LeaderCard({
  leader,
  rank,
  selected,
  onSelect,
}: {
  leader: ExpansionLeader;
  rank: number;
  selected: boolean;
  onSelect: (symbol: string) => void;
}) {
  const tone = expansionTone(leader.stage, leader.direction);
  const stage = expansionStageLabel(leader.stage);
  return (
    <button
      type="button"
      data-testid="live-leader-card"
      data-symbol={leader.symbol}
      data-direction={leader.direction}
      aria-pressed={selected}
      aria-label={`${leader.symbol}, ${leader.direction}, ${stage}. Open expansion details.`}
      onClick={() => onSelect(leader.symbol)}
      className="live-leader-card snap-start text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-champagne"
      style={{
        borderColor: selected ? "var(--amber)" : "var(--border)",
        boxShadow: selected ? "0 0 0 1px rgba(214,166,63,0.28)" : undefined,
      }}
    >
      <span className="live-leader-rank font-mono" aria-hidden="true">
        {rank}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} aria-hidden="true" />
          <strong className="font-mono text-[13px]" style={{ color: "var(--text)" }}>
            {leader.symbol}
          </strong>
          <span className="ml-auto text-[9px] uppercase tracking-[0.09em]" style={{ color: tone }}>
            {leader.direction}
          </span>
        </span>
        <span className="mt-1 block font-mono tabular text-[15px]" style={{ color: "var(--text)" }}>
          {money(leader.currentPrice)}
        </span>
        <span className="block font-mono tabular text-[10px]" style={{ color: tone }}>
          {signedMoney(leader.dollarMove)} ({signedPct(leader.percentMove)})
        </span>
        <span
          className="mt-2 inline-flex rounded px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em]"
          style={{ color: tone, border: `1px solid ${tone}` }}
        >
          {stage}
        </span>
        <span className="mt-1.5 block truncate text-[9px]" style={{ color: "var(--text-muted)" }}>
          {leader.reasons.length > 0 ? leader.reasons.join(" · ") : "Measured stage transition"}
        </span>
      </span>
    </button>
  );
}

export function LiveLeaders({
  expansionBySymbol,
  expansionMonitorBySymbol,
  selectedSymbol,
  onSelect,
  loading,
}: {
  expansionBySymbol?: Record<string, SymbolExpansion>;
  expansionMonitorBySymbol?: Record<string, SymbolExpansionMonitor>;
  selectedSymbol: string | null;
  onSelect: (symbol: string) => void;
  loading: boolean;
}) {
  const leaders = useMemo(
    () => buildExpansionLeaders(expansionBySymbol, expansionMonitorBySymbol, 5),
    [expansionBySymbol, expansionMonitorBySymbol]
  );

  return (
    <section className="space-y-2" aria-label="Live expansion leaders">
      <div className="flex items-center justify-between gap-3">
        <h2 className="card-heading">Live leaders</h2>
        <span
          className="text-[9px] uppercase tracking-[0.1em]"
          style={{ color: "var(--text-muted)" }}
          title="Leaders are ordered by confirmed expansion stage, then ATR-normalized movement when available, relative dollar volume, sector-relative performance, and recency. This is not a confidence score."
        >
          Sorted by Expansion Stage
        </span>
      </div>

      {loading && (
        <div className="live-leaders-strip" aria-label="Loading live leaders">
          {[0, 1, 2].map((key) => (
            <div key={key} className="live-leader-skeleton" aria-hidden="true" />
          ))}
        </div>
      )}

      {!loading && expansionBySymbol === undefined && (
        <div className="command-panel px-4 py-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
          Expansion data unavailable.
        </div>
      )}

      {!loading && expansionBySymbol !== undefined && leaders.length === 0 && (
        <div className="command-panel px-4 py-3">
          <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            No active expansion leaders right now.
          </p>
          <p className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
            Watching for premarket activity, acceleration, and confirmed breaks.
          </p>
        </div>
      )}

      {!loading && leaders.length > 0 && (
        <div className="live-leaders-strip" data-testid="live-leaders-strip">
          {leaders.map((leader, index) => (
            <LeaderCard
              key={`${leader.symbol}:${leader.direction}`}
              leader={leader}
              rank={index + 1}
              selected={leader.symbol === selectedSymbol}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}
