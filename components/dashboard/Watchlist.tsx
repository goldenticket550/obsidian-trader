"use client";

import type { WatchlistSymbol } from "@/types/watchlist";

const STATUS_DOT_CLASS: Record<"red" | "yellow" | "green", string> = {
  red: "bg-signal-red",
  yellow: "bg-signal-yellow",
  green: "bg-signal-green",
};

function StatusDot({ status }: { status: "red" | "yellow" | "green" }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_CLASS[status]}`} />;
}

export function Watchlist({
  symbols,
  selected,
  onSelect,
}: {
  symbols: WatchlistSymbol[];
  selected: string | null;
  onSelect: (ticker: string) => void;
}) {
  return (
    <section className="panel">
      <div className="px-5 py-4 border-b border-obsidian-border flex items-center justify-between">
        <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim">Watchlist</h2>
        <span className="text-xs text-platinum-dim">{symbols.length} symbols</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-platinum-dim border-b border-obsidian-border">
            <th className="px-5 py-2 font-normal">Ticker</th>
            <th className="px-3 py-2 font-normal">Price</th>
            <th className="px-3 py-2 font-normal">Chg %</th>
            <th className="px-3 py-2 font-normal">From Low</th>
            <th className="px-3 py-2 font-normal">5m Score</th>
            <th className="px-3 py-2 font-normal">15m Score</th>
            <th className="px-3 py-2 font-normal">Last Signal</th>
          </tr>
        </thead>
        <tbody>
          {symbols.map((s) => (
            <tr
              key={s.ticker}
              onClick={() => onSelect(s.ticker)}
              className={`cursor-pointer border-b border-obsidian-border/60 last:border-0 hover:bg-white/[0.03] transition-colors ${
                selected === s.ticker ? "bg-white/[0.04]" : ""
              }`}
            >
              <td className="px-5 py-3 font-mono text-platinum-bright">{s.ticker}</td>
              <td className="px-3 py-3 font-mono">${s.price.toFixed(2)}</td>
              <td className={`px-3 py-3 font-mono ${s.dailyChangePct < 0 ? "text-signal-red" : "text-signal-green"}`}>
                {s.dailyChangePct > 0 ? "+" : ""}
                {s.dailyChangePct.toFixed(1)}%
              </td>
              <td className="px-3 py-3 font-mono text-platinum-dim">{s.distanceFromSessionLowPct.toFixed(1)}%</td>
              <td className="px-3 py-3">
                <span className="inline-flex items-center gap-2 font-mono">
                  <StatusDot status={s.status5m} />
                  {s.score5m}
                </span>
              </td>
              <td className="px-3 py-3">
                <span className="inline-flex items-center gap-2 font-mono">
                  <StatusDot status={s.status15m} />
                  {s.score15m}
                </span>
              </td>
              <td className="px-3 py-3 text-platinum-dim text-xs">
                {s.lastSignalTime ? new Date(s.lastSignalTime).toLocaleTimeString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
