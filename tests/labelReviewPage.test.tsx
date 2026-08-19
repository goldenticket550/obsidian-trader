// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LabelReviewPage from "@/app/labels/page";
import type { LabelReview } from "@/lib/replay/labelStore";

const review: LabelReview = {
  tradingDate: "2025-08-15",
  quietSession: null,
  reviewCompleted: false,
  candidates: [{
    id: "2025-08-15:NVDA", tradingDate: "2025-08-15", symbol: "NVDA", rank: 1,
    decision: "pending", selectionReasons: ["thirty_minute_travel"], rangeAtr: 1.5,
    maxWindowTravelAtr: 1.2, time_it_became_interesting: "10:03:00",
    time_i_actually_noticed: null, direction: "bullish", reason_tags: ["range_expansion"],
    editedFields: [], sparkline: { times: [1, 2], prices: [100, 102], volumes: [10, 20] },
  }],
  labels: [],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
    ok: true,
    json: async () => init?.method === "PATCH" ? { ok: true } : { review },
  })));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("§2.3b label review surface", () => {
  it("renders generated candidates pending with no default accept or quiet decision", async () => {
    render(<LabelReviewPage />);
    expect(await screen.findByText("NVDA")).toBeTruthy();
    expect(screen.queryByText(/This is unlabelled/)).toBeNull();
    expect(screen.getByRole("button", { name: "Complete review" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Quiet session" }).className).not.toContain("border-platinum-bright");
    expect(screen.getByRole("button", { name: "Not quiet" }).className).not.toContain("border-platinum-bright");
  });

  it("persists accept immediately through the authenticated API", async () => {
    render(<LabelReviewPage />);
    const accept = await screen.findByRole("button", { name: "Accept" });
    fireEvent.click(accept);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/labels", expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"decision":"accepted"') })));
  });

  it("offers the explicit missed-candidate path and label export", async () => {
    render(<LabelReviewPage />);
    await screen.findByText("NVDA");
    expect(screen.getByRole("button", { name: "Add missed name" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download labels" }).getAttribute("href")).toContain("download=1");
  });
});
