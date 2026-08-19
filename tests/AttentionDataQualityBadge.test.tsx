// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AttentionDataQualityBadge } from "@/components/dashboard/AttentionDataQualityBadge";

afterEach(() => cleanup());

describe("AttentionDataQualityBadge", () => {
  it("shows limited history explicitly instead of hiding the symbol", () => {
    render(<AttentionDataQualityBadge state="limited_history" reason="44/120 sessions since listing" />);
    expect(screen.getByText("Limited history")).toBeTruthy();
    expect(screen.getByText("Limited history").getAttribute("title")).toBe("44/120 sessions since listing");
  });
});
