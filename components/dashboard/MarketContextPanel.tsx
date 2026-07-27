"use client";

import type { MarketContextQuote } from "@/lib/market-data/marketContext";
import { formatEasternTime } from "@/lib/market-data/freshness";

export function MarketContextPanel({
  quotes,
  loading,
  error,
}: {
  quotes: MarketContextQuote[] | null;
  loading: boolean;
  error: string | null;
}) {
  // When every instrument shares one timestamp, show it once in the
  // footer instead of repeating it on all three rows.
  const stamps = (quotes ?? []).map((q) => q.asOf).filter((a): a is string => !!a);
  const sharedStamp =
    stamps.length > 0 && stamps.every((s) => s === stamps[0]) ? stamps[0] : null;

  return (
    <section className="panel px-4 py-3" aria-label="Market context">
      <h2 className="card-heading mb-2">Market context</h2>

      {loading && (
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          Loading…
        </p>
      )}

      {error && !loading && (
        <p className="text-[11px]" style={{ color: "var(--red)" }}>
          Unavailable — {error}
        </p>
      )}

      {!loading && !error && quotes && quotes.length > 0 && (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              <th className="text-left font-normal pb-1">Symbol</th>
              <th className="text-right font-normal pb-1">Price</th>
              <th className="text-right font-normal pb-1">Chg</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.symbol}>
                <td className="py-[3px]" style={{ color: "var(--text-secondary)" }}>
                  {q.label}
                </td>
                <td
                  className="py-[3px] text-right font-mono tabular"
                  style={{ color: "var(--text)" }}
                >
                  {q.price === null ? "—" : `$${q.price.toFixed(2)}`}
                </td>
                <td
                  className="py-[3px] text-right font-mono tabular"
                  style={{
                    color:
                      q.changePct === null
                        ? "var(--text-muted)"
                        : q.changePct < 0
                        ? "var(--red)"
                        : "var(--green)",
                  }}
                >
                  {q.changePct === null
                    ? "—"
                    : `${q.changePct > 0 ? "+" : ""}${(q.changePct * 100).toFixed(2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && !error && quotes && quotes.some((q) => q.price === null) && (
        <p className="mt-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
          Unavailable instruments have no data from the provider.
        </p>
      )}

      <p
        className="mt-2 pt-1.5 text-[10px] leading-relaxed"
        style={{ borderTop: "1px solid var(--border-soft)", color: "var(--text-muted)" }}
      >
        {sharedStamp
          ? `Market data as of ${formatEasternTime(sharedStamp)} · daily bars`
          : "Daily bars via the configured provider"}
      </p>
    </section>
  );
}
