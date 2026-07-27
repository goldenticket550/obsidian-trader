// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SignalRow } from "@/components/dashboard/SignalRow";
import { ActionQueue } from "@/components/dashboard/ActionQueue";
import type { AlertEvent, AlertType } from "@/lib/alerts/types";

afterEach(cleanup);

const NOW = Date.parse("2026-07-27T18:00:00Z");

function makeEvent(type: AlertType, firedAt: string, symbol = "NVDA"): AlertEvent {
  return {
    id: `${type}-${firedAt}-${symbol}`,
    ruleId: `rule_${type}`,
    type,
    symbol,
    timeframe: "5m",
    message: "Something happened",
    firedAt,
  };
}

describe("SignalRow window toggle (Issue 2)", () => {
  it("shows the selected window as the active (pressed) control", () => {
    render(
      <SignalRow events={[]} window="last_60m" now={NOW} onWindowChange={() => {}} loading={false} />
    );
    expect(screen.getByRole("button", { name: "60m" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Recent" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps Recent selectable — clicking it requests the recent window", () => {
    const onWindowChange = vi.fn();
    render(
      <SignalRow events={[]} window="last_60m" now={NOW} onWindowChange={onWindowChange} loading={false} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    expect(onWindowChange).toHaveBeenCalledWith("recent");
  });

  it("counts only what it is given (the already-windowed collection)", () => {
    // Two liquidity sweeps handed in → the liquidity-sweep card reads 2.
    render(
      <SignalRow
        events={[
          makeEvent("liquidity_sweep", "2026-07-27T17:45:00Z"),
          makeEvent("liquidity_sweep", "2026-07-27T17:50:00Z"),
        ]}
        window="last_60m"
        now={NOW}
        onWindowChange={() => {}}
        loading={false}
      />
    );
    expect(screen.getByText("Liquidity sweep")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });
});

describe("ActionQueue empty state honours the window (Issue 2)", () => {
  it("shows the explicit 60-minute calm state when the 60m window is empty", () => {
    render(<ActionQueue alerts={[]} window="last_60m" resultsBySymbol={{}} loading={false} error={null} />);
    expect(screen.getByText("No alerts recorded in the last 60 minutes.")).toBeTruthy();
  });

  it("does not backfill older events into an empty 60m queue", () => {
    render(<ActionQueue alerts={[]} window="last_60m" resultsBySymbol={{}} loading={false} error={null} />);
    // The per-bucket group headings only render when there are events; an
    // empty window shows the single calm line instead.
    expect(screen.queryByText(/Risk \/ review now/i)).toBeNull();
  });

  it("shows a different calm state for an empty Recent window", () => {
    render(<ActionQueue alerts={[]} window="recent" resultsBySymbol={{}} loading={false} error={null} />);
    expect(screen.getByText("No recent alerts recorded.")).toBeTruthy();
  });

  it("renders the events it is handed (the windowed collection)", () => {
    render(
      <ActionQueue
        alerts={[makeEvent("score_threshold", "2026-07-27T17:55:00Z", "TSLA")]}
        window="last_60m"
        resultsBySymbol={{}}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByText("TSLA")).toBeTruthy();
    expect(screen.queryByText("No alerts recorded in the last 60 minutes.")).toBeNull();
  });
});
