"use client";

import { useEffect, useState } from "react";
import type { SetupResult, ConditionState, ConditionCategory, ConvictionLevel, EntryStatus } from "@/types/setup";
import { buildTradingViewUrl } from "@/lib/tradingview";
import { StageProgression } from "./StageProgression";
import { conditionExplanations } from "@/lib/strategies/conditionExplanations";
import { formatEasternTime, formatEasternDateTime, describeFeed } from "@/lib/market-data/freshness";

const STATE_LABEL: Record<ConditionState, string> = {
  pass: "Pass",
  fail: "Fail",
  waiting: "Waiting",
  invalidated: "Invalidated",
};

const STATE_COLOR: Record<ConditionState, string> = {
  pass: "var(--green)",
  fail: "var(--red)",
  waiting: "var(--amber)",
  invalidated: "var(--red)",
};

const CATEGORY_ORDER: ConditionCategory[] = ["core", "secondary", "supporting", "informational"];
const CATEGORY_LABEL: Record<ConditionCategory, string> = {
  core: "Core signals",
  secondary: "Secondary confirmations",
  supporting: "Supporting signals",
  informational: "Informational",
};

const CONVICTION_LABEL: Record<ConvictionLevel, string> = {
  watch: "Watch",
  developing: "Developing",
  confirmed: "Confirmed",
};

const CONVICTION_COLOR: Record<ConvictionLevel, string> = {
  watch: "var(--text-muted)",
  developing: "var(--amber)",
  confirmed: "var(--green)",
};

const ENTRY_LABEL: Record<EntryStatus, string> = {
  actionable_now: "Actionable now",
  wait_for_pullback: "Wait for pullback",
  extended_do_not_chase: "Extended — do not chase",
  invalidated: "Invalidated",
  insufficient_data: "Not enough data yet",
};

const ENTRY_COLOR: Record<EntryStatus, string> = {
  actionable_now: "var(--green)",
  wait_for_pullback: "var(--amber)",
  extended_do_not_chase: "var(--amber)",
  invalidated: "var(--red)",
  insufficient_data: "var(--text-muted)",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[3px]">
      <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span className="text-[11px] text-right min-w-0">{children}</span>
    </div>
  );
}

export function SetupDetail({
  result,
  exchange,
  timeframe,
  onTimeframeChange,
  scoreThreshold,
  score5m,
  score15m,
}: {
  result: SetupResult | null;
  exchange: string;
  timeframe: "5m" | "15m";
  onTimeframeChange: (tf: "5m" | "15m") => void;
  /** Configured minimum from risk settings; drives "Score qualified". */
  scoreThreshold: number;
  score5m: number;
  score15m: number;
  /** Retained for API compatibility with the previous panel usage. */
  embedded?: boolean;
}) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  // The full checklist is a collapsed disclosure by default. Collapse it
  // again whenever the selection changes (different symbol or timeframe),
  // so an expanded panel of stale details never stays associated with a
  // newly selected setup.
  const [checklistOpen, setChecklistOpen] = useState(false);
  useEffect(() => {
    setChecklistOpen(false);
  }, [result?.symbol, timeframe]);

  if (!result) return null;

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
  const invalidated = result.conditions.some((c) => c.state === "invalidated");
  const feed = describeFeed(result.quality, result.latestCandleTime, Date.now());

  // Stable id for the disclosure region aria-controls points at.
  const checklistRegionId = `full-checklist-${result.symbol}-${result.timeframe}`;

  // Drawer shows only what's currently actionable; the exhaustive
  // checklist lives behind a disclosure so the drawer stays short.
  const notable = result.conditions
    .filter((c) => c.state === "pass" || c.state === "waiting" || c.state === "invalidated")
    .sort((a, b) => {
      const rank = { invalidated: 0, waiting: 1, pass: 2, fail: 3 } as Record<string, number>;
      return (rank[a.state] ?? 9) - (rank[b.state] ?? 9);
    })
    .slice(0, 6);

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    conditions: result.conditions.filter((c) => (c.category ?? "supporting") === category),
  })).filter((g) => g.conditions.length > 0);

  return (
    <div className="panel-muted px-4 py-3" style={{ borderTop: "1px solid var(--border-soft)" }}>
      <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_220px] gap-4">
        {/* LEFT — scores, conviction, entry */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="card-heading">Timeframe</span>
            <div
              className="flex rounded overflow-hidden text-[10px]"
              style={{ border: "1px solid var(--border)" }}
              role="group"
              aria-label="Timeframe"
            >
              {(["5m", "15m"] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => onTimeframeChange(tf)}
                  aria-pressed={timeframe === tf}
                  className="px-2 py-0.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
                  style={
                    timeframe === tf
                      ? { background: "var(--amber-soft)", color: "var(--amber)" }
                      : { color: "var(--text-muted)" }
                  }
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-baseline gap-3 mb-2">
            <span>
              <span className="block text-[9px]" style={{ color: "var(--text-muted)" }}>
                5m
              </span>
              <span
                className="font-mono tabular text-[20px] leading-none"
                style={{ color: timeframe === "5m" ? "var(--text)" : "var(--text-muted)" }}
              >
                {score5m.toFixed(1)}
              </span>
            </span>
            <span>
              <span className="block text-[9px]" style={{ color: "var(--text-muted)" }}>
                15m
              </span>
              <span
                className="font-mono tabular text-[20px] leading-none"
                style={{ color: timeframe === "15m" ? "var(--text)" : "var(--text-muted)" }}
              >
                {score15m.toFixed(1)}
              </span>
            </span>
            <span className="text-[10px] self-end pb-0.5" style={{ color: "var(--text-muted)" }}>
              / 10
            </span>
          </div>

          <div style={{ borderTop: "1px solid var(--border-soft)" }} className="pt-1.5">
            {result.convictionLevel && (
              <Field label="Rules-based conviction">
                <span style={{ color: CONVICTION_COLOR[result.convictionLevel] }}>
                  {CONVICTION_LABEL[result.convictionLevel]}
                </span>
              </Field>
            )}
            {result.entryStatus && (
              <Field label="Entry status">
                <span style={{ color: ENTRY_COLOR[result.entryStatus] }}>
                  {ENTRY_LABEL[result.entryStatus]}
                </span>
              </Field>
            )}
          </div>
        </div>

        {/* CENTER — stage progression + notable conditions */}
        <div className="min-w-0">
          <StageProgression
            stage={result.stage}
            score={result.score}
            scoreThreshold={scoreThreshold}
            invalidated={invalidated}
          />

          <ul className="mt-3 space-y-1">
            {notable.map((c) => (
              <li
                key={c.id}
                className="flex items-baseline justify-between gap-3 text-[11px] py-[2px]"
              >
                <span className="min-w-0">
                  <span style={{ color: "var(--text-secondary)" }}>{c.label}</span>
                  {c.detail && (
                    <span className="ml-1.5" style={{ color: "var(--text-muted)" }}>
                      {c.detail}
                    </span>
                  )}
                </span>
                <span
                  className="font-mono text-[10px] shrink-0"
                  style={{ color: STATE_COLOR[c.state] }}
                >
                  {STATE_LABEL[c.state]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* RIGHT — provenance, invalidation, actions */}
        <div className="min-w-0">
          <span className="card-heading block mb-1.5">Provenance</span>
          <Field label="Scanned">
            <span className="font-mono tabular" style={{ color: "var(--text-secondary)" }}>
              {formatEasternTime(result.lastUpdated)}
            </span>
          </Field>
          <Field label="Latest candle">
            <span className="font-mono tabular" style={{ color: "var(--text-secondary)" }}>
              {result.latestCandleTime
                ? formatEasternDateTime(result.latestCandleTime)
                : "Unavailable"}
            </span>
          </Field>
          <Field label="Data quality">
            {/* Same rule as the page header: the feed being real-time
                capable says nothing about how old this candle is. */}
            <span
              style={{
                color: feed.staleness === "current" ? "var(--text-secondary)" : "var(--amber)",
              }}
            >
              {feed.label}
            </span>
          </Field>

          {result.invalidationNote && (
            <div
              className="mt-2 pt-2 text-[10px] leading-snug"
              style={{ borderTop: "1px solid var(--border-soft)", color: "var(--text-muted)" }}
            >
              <span className="block mb-0.5" style={{ color: "var(--red)" }}>
                Invalidation watch
              </span>
              {result.invalidationNote}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <button onClick={handleExplain} disabled={explaining} className="btn-primary">
              {explaining ? "Thinking…" : "Review setup"}
            </button>
            <a
              href={tvUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary inline-block"
            >
              TradingView ↗
            </a>
          </div>
        </div>
      </div>

      {(explainError || explanation) && (
        <div className="mt-3 pt-2" style={{ borderTop: "1px solid var(--border-soft)" }}>
          {explainError && (
            <p className="text-[11px]" style={{ color: "var(--red)" }}>
              {explainError}
            </p>
          )}
          {explanation && (
            <p
              className="text-[11px] leading-relaxed pl-2.5"
              style={{ borderLeft: "2px solid var(--border)", color: "var(--text-secondary)" }}
            >
              {explanation}
            </p>
          )}
        </div>
      )}

      {/* Full checklist is a controlled disclosure, collapsed by default —
          rendering all twelve conditions with their reasoning was what made
          the drawer push every other opportunity off-screen. A real button
          (not a <summary>) so the label can honestly say "View" vs "Hide"
          and expose aria-expanded/aria-controls. */}
      <div className="mt-2.5" style={{ borderTop: "1px solid var(--border-soft)" }}>
        <button
          type="button"
          onClick={() => setChecklistOpen((open) => !open)}
          aria-expanded={checklistOpen}
          aria-controls={checklistRegionId}
          className="btn-secondary inline-block mt-2.5 cursor-pointer select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
          style={{ width: "fit-content" }}
        >
          {checklistOpen ? "Hide full checklist" : `View full checklist (${result.conditions.length})`}
        </button>

        {/* One region, toggled with `hidden` — never a second copy, and no
            refetch/recalc on open (the disclosure only flips local state). */}
        <div
          id={checklistRegionId}
          hidden={!checklistOpen}
          className="mt-2.5 grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-3"
        >
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="card-heading mb-1">{CATEGORY_LABEL[group.category]}</div>
              <ul className="space-y-1.5">
                {group.conditions.map((c) => {
                  const info = conditionExplanations[c.id];
                  const reasoning =
                    c.state === "pass" || c.state === "waiting"
                      ? info?.whyItMatters
                      : info?.whatItMeans ?? info?.whyItMatters;
                  const watchFor = c.state === "waiting" ? info?.whatToWatchFor : undefined;

                  return (
                    <li key={c.id} className="text-[11px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <span style={{ color: "var(--text-secondary)" }}>
                          {c.label}
                          {!c.required && (
                            <span
                              className="ml-1.5 text-[9px] uppercase"
                              style={{ color: "var(--text-muted)" }}
                            >
                              optional
                            </span>
                          )}
                        </span>
                        <span
                          className="font-mono text-[10px] shrink-0"
                          style={{ color: STATE_COLOR[c.state] }}
                        >
                          {STATE_LABEL[c.state]}
                        </span>
                      </div>
                      {c.detail && (
                        <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {c.detail}
                        </div>
                      )}
                      {reasoning && (
                        <div
                          className="text-[10px] mt-0.5 leading-snug"
                          style={{ color: "var(--text-muted)", opacity: 0.8 }}
                        >
                          {reasoning}
                        </div>
                      )}
                      {watchFor && (
                        <div
                          className="text-[10px] mt-0.5 italic"
                          style={{ color: "var(--text-muted)", opacity: 0.65 }}
                        >
                          {watchFor}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-2.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
        A green status means this setup is ready for manual review — it is never a buy signal.
      </p>
    </div>
  );
}
