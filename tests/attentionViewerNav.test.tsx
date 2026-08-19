// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/attention",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));

import { NavBar } from "@/components/layout/NavBar";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function access(role: "owner" | "viewer") {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ role }) }));
}

describe("role-aware navigation", () => {
  it("offers a viewer only the shared Attention page", async () => {
    access("viewer");
    render(<NavBar />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Attention" }).getAttribute("href")).toBe("/attention");
    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(screen.queryByText("Journal")).toBeNull();
    expect(screen.queryByText("Labels")).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
  });

  it("retains the full owner navigation", async () => {
    access("owner");
    render(<NavBar />);
    await waitFor(() => expect(screen.getByText("Dashboard")).toBeTruthy());
    expect(screen.getByText("Journal")).toBeTruthy();
    expect(screen.getByText("Labels")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });
});
