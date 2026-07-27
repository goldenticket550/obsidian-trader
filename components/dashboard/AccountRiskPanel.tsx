"use client";

import type { RiskSettings, DailyTradingStatus } from "@/types/risk";
import type { AccountabilityChecks } from "@/types/watchlist";

/**
 * Every figure comes straight from risk_settings / daily_trading_status.
 * Account VALUE is deliberately absent: there is no brokerage-balance
 * source, and a plausible portfolio number is exactly the sort of
 * authoritative fiction this dashboard must not contain.
 */
function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[3px]">
      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span
        className="font-mono tabular text-[12px]"
        style={{ color: tone ?? "var(--text-secondary)" }}
      >
        {value}
      </span>
    </div>
  );
}

export function AccountRiskPanel({
  settings,
  status,
  checks,
}: {
  settings: RiskSettings | null;
  status: DailyTradingStatus | null;
  checks: AccountabilityChecks | null;
}) {
  if (!settings || !status) {
    return (
      <section className="panel px-4 py-3" aria-label="Account and risk">
        <h2 className="card-heading mb-2">Account &amp; risk</h2>
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          Unavailable
        </p>
      </section>
    );
  }

  const pnl = status.realizedPnl;
  const lossUsed = pnl < 0 ? Math.abs(pnl) : 0;
  const remainingLoss = Math.max(0, settings.maxLossPerDay - lossUsed);

  return (
    <section className="panel px-4 py-3" aria-label="Account and risk">
      <h2 className="card-heading mb-2">Account &amp; risk</h2>

      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Daily P&amp;L
        </span>
        <span
          className="font-mono tabular text-[20px] leading-none"
          style={{
            color: pnl < 0 ? "var(--red)" : pnl > 0 ? "var(--green)" : "var(--text)",
          }}
        >
          {pnl < 0 ? "−" : pnl > 0 ? "+" : ""}${Math.abs(pnl).toFixed(2)}
        </span>
      </div>

      <div style={{ borderTop: "1px solid var(--border-soft)" }} className="pt-1.5">
        <Row
          label="Trades taken"
          value={`${status.tradesTaken} / ${settings.maxTradesPerDay}`}
        />
        <Row label="Max daily loss" value={`$${settings.maxLossPerDay.toFixed(2)}`} />
        <Row
          label="Loss capacity left"
          value={`$${remainingLoss.toFixed(2)}`}
          tone={remainingLoss === 0 ? "var(--red)" : undefined}
        />
        {checks && <Row label="Trades remaining" value={String(checks.tradesRemaining)} />}
      </div>

      {checks?.dailyLossLimitReached && (
        <p className="mt-2 text-[10px]" style={{ color: "var(--red)" }}>
          Daily loss limit reached.
        </p>
      )}
      {checks?.dailyGoalReached && !checks.dailyLossLimitReached && (
        <p className="mt-2 text-[10px]" style={{ color: "var(--green)" }}>
          Daily profit target reached.
        </p>
      )}
    </section>
  );
}
