"use client";

import type { AlertEvent } from "@/lib/alerts/types";
import {
  computeSignalCards,
  SIGNAL_WINDOW_LABEL,
  type SignalWindow,
} from "@/lib/alerts/signalCounts";

/** Category accents, matching the action queue so a concept keeps one
 * color across the whole page. */
const ACCENT: Record<string, string> = {
  liquidity_sweep: "var(--green)",
  structure_shift: "var(--violet)",
  ema_reclaim: "var(--blue)",
  fvg_entry: "var(--amber)",
  score_threshold: "var(--green)",
  expansion: "var(--green)",
};

/** Inline SVG marks — five small shapes, not worth an icon dependency.
 * Each is a loose visual metaphor for its signal, drawn on a 16x16 grid. */
function SignalIcon({ kind, color }: { kind: string; color: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: color,
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (kind) {
    case "liquidity_sweep": // dip below a level, then back up
      return (
        <svg {...common}>
          <path d="M2 5h12" strokeDasharray="2 2" opacity="0.5" />
          <path d="M3 8l3 4 3-7 4 5" />
        </svg>
      );
    case "structure_shift": // step up through a prior high
      return (
        <svg {...common}>
          <path d="M2 12h4V8h4V4h4" />
        </svg>
      );
    case "ema_reclaim": // price crossing back above a curve
      return (
        <svg {...common}>
          <path d="M2 11c4 0 5-6 12-6" opacity="0.55" />
          <path d="M2 13l4-1 4-3 4-4" />
        </svg>
      );
    case "fvg_entry": // gap band being entered
      return (
        <svg {...common}>
          <rect x="2.5" y="5.5" width="11" height="5" opacity="0.55" />
          <path d="M8 2v3M8 11v3" />
        </svg>
      );
    default: // score threshold — a bar clearing a line
      return (
        <svg {...common}>
          <path d="M2 6h12" strokeDasharray="2 2" opacity="0.5" />
          <path d="M4 13V9M8 13V4M12 13V7" />
        </svg>
      );
  }
}

export function SignalRow({
  events,
  window,
  now = Date.now(),
  onWindowChange,
  loading,
  expansionCount = 0,
}: {
  events: AlertEvent[];
  window: SignalWindow;
  /** Shared with the ActionQueue so counts and queue filter identically.
   * Defaults to the current time when rendered standalone. */
  now?: number;
  onWindowChange: (w: SignalWindow) => void;
  loading: boolean;
  /** Current qualifying expansion candidates, separate from alert-event counts. */
  expansionCount?: number;
}) {
  // Pure count over the events actually held — no projection anywhere.
  const cards = computeSignalCards(events, window, now).map(({ key, label, count }) => ({
    key,
    label,
    count,
  }));
  cards.splice(4, 1, {
    key: "expansion",
    label: "Expansion",
    count: expansionCount,
  });

  return (
    <section aria-label="Signal counts" className="command-panel px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="card-heading">{SIGNAL_WINDOW_LABEL[window]}</span>
          {/* Replaces the permanent explanatory paragraph. */}
          <span
            tabIndex={0}
            role="img"
            aria-label="Sweep, structure, EMA, and FVG are recorded alert events in the selected window. Expansion is the current qualifying candidate count."
            title="Sweep, structure, EMA, and FVG are recorded alert events in the selected window. Expansion is the current qualifying candidate count."
            className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full text-[9px] cursor-help focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            i
          </span>
        </div>

        <div
          className="flex rounded overflow-hidden text-[10px]"
          style={{ border: "1px solid var(--border)" }}
          role="group"
          aria-label="Signal count window"
        >
          {(["recent", "last_60m"] as const).map((w) => (
            <button
              key={w}
              onClick={() => onWindowChange(w)}
              aria-pressed={window === w}
              className="px-2 py-0.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-champagne"
              style={
                window === w
                  ? { background: "var(--amber-soft)", color: "var(--amber)" }
                  : { color: "var(--text-muted)" }
              }
            >
              {w === "recent" ? "Recent" : "60m"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center overflow-x-auto divide-x" style={{ borderColor: "var(--border-soft)" }}>
        {cards.map((card) => {
          const color = ACCENT[card.key] ?? "var(--text)";
          return (
            <div key={card.key} className="px-3 py-1.5 flex items-center gap-2 min-w-[150px] flex-1">
              <span
                className="shrink-0 flex items-center justify-center h-6 w-6 rounded"
                style={{ background: "var(--panel-raised)" }}
              >
                <SignalIcon kind={card.key} color={color} />
              </span>
              <span className="min-w-0">
                <span
                  className="block text-[11px] leading-tight truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {card.label}
                </span>
                <span
                  className="block font-mono tabular text-[14px] leading-none mt-0.5"
                  style={{ color: card.count > 0 ? color : "var(--text-muted)" }}
                >
                  {loading ? "—" : card.count}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
