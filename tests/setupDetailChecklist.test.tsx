// @vitest-environment happy-dom
import type { ComponentProps } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SetupDetail } from "@/components/dashboard/SetupDetail";
import { mockSetupResults } from "@/lib/mock/setups";

afterEach(cleanup);

const result = mockSetupResults.NVDA;
const regionId = `full-checklist-${result.symbol}-${result.timeframe}`;
/** Attribute selector — avoids CSS.escape (not present in happy-dom). */
const byId = (id: string) => `[id="${id}"]`;

function renderDetail(props?: Partial<ComponentProps<typeof SetupDetail>>) {
  return render(
    <SetupDetail
      result={result}
      exchange="NASDAQ"
      timeframe="5m"
      onTimeframeChange={() => {}}
      scoreThreshold={6}
      score5m={6}
      score15m={5}
      {...props}
    />
  );
}

describe("SetupDetail — full checklist disclosure (Issue 1)", () => {
  it("starts collapsed: 'View full checklist (N)' label and the region hidden", () => {
    const { container } = renderDetail();
    const button = screen.getByRole("button", { name: /view full checklist \(\d+\)/i });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    const region = container.querySelector(byId(regionId));
    expect(region).not.toBeNull();
    expect(region!.hasAttribute("hidden")).toBe(true); // present but not visible
  });

  it("expands on click: label becomes 'Hide full checklist', aria-expanded true, region visible", () => {
    const { container } = renderDetail();
    const button = screen.getByRole("button", { name: /view full checklist/i });
    fireEvent.click(button);

    expect(screen.getByRole("button", { name: /hide full checklist/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /view full checklist/i })).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");

    const region = container.querySelector(byId(regionId));
    expect(region!.hasAttribute("hidden")).toBe(false);
  });

  it("collapses again on a second click", () => {
    const { container } = renderDetail();
    const button = screen.getByRole("button", { name: /view full checklist/i });
    fireEvent.click(button); // expand
    fireEvent.click(button); // collapse

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /view full checklist \(\d+\)/i })).toBeTruthy();
    const region = container.querySelector(byId(regionId));
    expect(region!.hasAttribute("hidden")).toBe(true);
  });

  it("aria-controls points at the single stable region id", () => {
    const { container } = renderDetail();
    const button = screen.getByRole("button", { name: /full checklist/i });
    expect(button.getAttribute("aria-controls")).toBe(regionId);
  });

  it("never renders two copies of the checklist region (no duplicate mount)", () => {
    const { container } = renderDetail();
    // Exactly one region node, whether collapsed or expanded.
    expect(container.querySelectorAll(byId(regionId)).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /full checklist/i }));
    expect(container.querySelectorAll(byId(regionId)).length).toBe(1);
  });

  it("does NOT refetch/recalculate the setup when the disclosure opens", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: /full checklist/i }));
    // The disclosure only flips local state — the AI 'Review setup' fetch is
    // a separate control and must not fire from expanding the checklist.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("collapses when the selected timeframe changes (no stale expanded panel)", () => {
    const { container, rerender } = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: /full checklist/i }));
    expect(container.querySelector(byId(regionId))!.hasAttribute("hidden")).toBe(false);

    // Same symbol, different timeframe → the panel must reset to collapsed.
    // Mirrors real usage: the 15m SetupResult is swapped in alongside the prop.
    rerender(
      <SetupDetail
        result={{ ...result, timeframe: "15m" }}
        exchange="NASDAQ"
        timeframe="15m"
        onTimeframeChange={() => {}}
        scoreThreshold={6}
        score5m={6}
        score15m={5}
      />
    );
    const newRegion = container.querySelector(byId(`full-checklist-${result.symbol}-15m`));
    expect(newRegion).not.toBeNull();
    expect(newRegion!.hasAttribute("hidden")).toBe(true);
  });

  it("collapses when the selected symbol changes", () => {
    const { container, rerender } = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: /full checklist/i }));

    const other = { ...result, symbol: "AMD" };
    rerender(
      <SetupDetail
        result={other}
        exchange="NASDAQ"
        timeframe="5m"
        onTimeframeChange={() => {}}
        scoreThreshold={6}
        score5m={6}
        score15m={5}
      />
    );
    const newRegion = container.querySelector(byId("full-checklist-AMD-5m"));
    expect(newRegion!.hasAttribute("hidden")).toBe(true);
  });
});
