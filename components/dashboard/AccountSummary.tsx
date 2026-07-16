import type { AccountSummary as AccountSummaryType } from "@/types/watchlist";

function StatBlock({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const toneClass =
    tone === "green" ? "text-signal-green" : tone === "red" ? "text-signal-red" : "text-platinum-bright";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-platinum-dim mb-1">{label}</div>
      <div className={`font-mono text-lg ${toneClass}`}>{value}</div>
    </div>
  );
}

export function AccountSummary({ summary }: { summary: AccountSummaryType }) {
  const pnlTone = summary.dailyRealizedPnl >= 0 ? "green" : "red";
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim">
          Account Summary
        </h2>
        <span className="text-xs font-mono text-platinum-dim">{summary.tradingDate}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
        <StatBlock label="Trade Limit" value={`${summary.tradesTakenToday} / ${summary.dailyTradeLimit}`} />
        <StatBlock
          label="Daily P&L"
          value={`${summary.dailyRealizedPnl >= 0 ? "+" : ""}$${summary.dailyRealizedPnl.toFixed(2)}`}
          tone={pnlTone}
        />
        <StatBlock label="Max Loss" value={`$${summary.dailyMaxLoss.toFixed(2)}`} />
        <StatBlock
          label="Status"
          value={summary.accountabilityStatus.replace(/_/g, " ")}
        />
      </div>
    </section>
  );
}
