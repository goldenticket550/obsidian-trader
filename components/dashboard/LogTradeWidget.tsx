"use client";

import { useState } from "react";

export function LogTradeWidget({ onLogged }: { onLogged: () => void }) {
  const [pnl, setPnl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pnlDelta = Number(pnl);
    if (Number.isNaN(pnlDelta)) {
      setError("Enter a number");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/risk/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pnlDelta }),
    });

    if (!res.ok) {
      const json = await res.json();
      setError(json.error ?? "Failed to log trade");
      setSubmitting(false);
      return;
    }

    setPnl("");
    setSubmitting(false);
    onLogged();
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="number"
        step="0.01"
        value={pnl}
        onChange={(e) => setPnl(e.target.value)}
        placeholder="P&L e.g. -50 or 120"
        className="w-36 bg-obsidian-charcoal border border-obsidian-border rounded px-2 py-1.5 text-xs text-platinum-bright focus:outline-none focus:border-platinum-dim"
      />
      <button
        type="submit"
        disabled={submitting || !pnl}
        className="text-xs bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-50 border border-obsidian-border rounded px-3 py-1.5 text-platinum-bright transition-colors"
      >
        Log trade
      </button>
      {error && <span className="text-xs text-signal-red">{error}</span>}
    </form>
  );
}
