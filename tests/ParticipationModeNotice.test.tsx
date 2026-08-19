// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ParticipationModeNotice } from "@/components/dashboard/ParticipationModeNotice";

afterEach(() => cleanup());

describe("ParticipationModeNotice", () => {
  it("surfaces first-observed activity as a headline alert", () => {
    render(<ParticipationModeNotice baselineMode="dead" firstObservedActivity dataQualityState="dead_unexpected_activity" />);
    expect(screen.getByText("Participation mode: dead")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("First observed activity");
    expect(screen.getByRole("alert").textContent).toContain("Displacement confirmation required");
  });

  it("shows mode without a false first-observed headline for expected absence", () => {
    render(<ParticipationModeNotice baselineMode="dead" firstObservedActivity={false} dataQualityState="dead_expected_absence" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
