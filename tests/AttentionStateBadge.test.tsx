// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AttentionStateBadge } from "@/components/dashboard/AttentionStateBadge";

afterEach(() => cleanup());

describe("Attention state membership explanation", () => {
  it("renders state as a badge and explains a settled hysteresis inversion in plain language", () => {
    render(<AttentionStateBadge
      state="WATCHING"
      pendingTransition="none"
      pendingTransitionMinutes={0}
      explanation="held in WATCHING since 09:14; core 0.846 is above exit 0.700 and below EMERGING entry 0.900"
    />);
    expect(screen.getByText("Watching")).toBeTruthy();
    expect(screen.getByText(/below EMERGING entry/)).toBeTruthy();
  });

  it("shows pending direction and minute count", () => {
    render(<AttentionStateBadge
      state="WATCHING"
      pendingTransition="promoting"
      pendingTransitionMinutes={1}
      explanation="promotion pending toward EMERGING; threshold condition held for 1 minute since 09:15"
    />);
    expect(screen.getByText(/promoting 1m/)).toBeTruthy();
    expect(screen.getByText(/promotion pending/)).toBeTruthy();
  });
});
