"use client";

import type { MarketContextQuote } from "@/lib/market-data/marketContext";

const PULSE_SYMBOLS = ["QQQ", "SPY", "IWM", "XLC"] as const;

function formatChange(value: number | null): string {
  if (value === null) return "--";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function Sparkline({
  values,
  positive,
  symbol,
}: {
  values: number[];
  positive: boolean;
  symbol: string;
}) {
  if (values.length < 2) {
    return (
      <span className="text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
        No trace
      </span>
    );
  }

  const width = 92;
  const height = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - 3 - ((value - min) / spread) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color = positive ? "var(--green)" : "var(--red)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-8 w-[92px]"
      role="img"
      aria-label={`${symbol} recent daily close trend`}
      preserveAspectRatio="none"
    >
      <line
        x1="0"
        y1={height - 3}
        x2={width}
        y2={height - 3}
        stroke="var(--border-soft)"
        strokeWidth="1"
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MarketPulse({
  quotes,
  loading,
  error,
}: {
  quotes: MarketContextQuote[] | null;
  loading: boolean;
  error: string | null;
}) {
  const bySymbol = new Map((quotes ?? []).map((quote) => [quote.symbol, quote]));

  return (
    <section aria-label="Market pulse" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="card-heading">Market pulse</h2>
        <span className="text-[9px] uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
          Recent daily closes
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {PULSE_SYMBOLS.map((symbol) => {
          const quote = bySymbol.get(symbol);
          const change = quote?.changePct ?? null;
          const positive = change === null || change >= 0;
          const tone =
            change === null ? "var(--text-muted)" : positive ? "var(--green)" : "var(--red)";

          return (
            <article
              key={symbol}
              className="command-panel min-h-[72px] px-3 py-2.5 flex items-center justify-between gap-3 overflow-hidden"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: quote?.price !== null && quote ? tone : "var(--text-muted)" }}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[12px]" style={{ color: "var(--text)" }}>
                    {symbol}
                  </span>
                </div>
                <p className="font-mono tabular text-[15px] mt-1" style={{ color: "var(--text)" }}>
                  {loading
                    ? "--"
                    : quote?.price === null || !quote
                    ? "Unavailable"
                    : `$${quote.price.toFixed(2)}`}
                </p>
                <p className="font-mono tabular text-[10px]" style={{ color: tone }}>
                  {error ? "Unavailable" : formatChange(change)}
                </p>
              </div>
              <Sparkline values={quote?.sparkline ?? []} positive={positive} symbol={symbol} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
