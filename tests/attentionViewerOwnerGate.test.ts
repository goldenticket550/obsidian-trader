import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, resolveAttentionAccess } = vi.hoisted(() => ({
  getUser: vi.fn(), resolveAttentionAccess: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("@/lib/attention-runtime/access", () => ({
  configuredAttentionEngineInstanceId: () => "engine",
  resolveAttentionAccess,
}));

import { GET, PATCH, POST } from "@/app/api/labels/route";

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: "viewer" } } });
  resolveAttentionAccess.mockResolvedValue({ engineInstanceId: "engine", role: "viewer" });
});

describe("viewer owner-only API refusal", () => {
  it("refuses label reads", async () => {
    const response = await GET(new Request("http://localhost/api/labels?date=2026-08-19"));
    expect(response.status).toBe(403);
  });

  it("refuses both label write methods before touching the store", async () => {
    const post = await POST(new Request("http://localhost/api/labels", {
      method: "POST", body: JSON.stringify({ action: "manual_add", tradingDate: "2026-08-19" }),
    }));
    const patch = await PATCH(new Request("http://localhost/api/labels", {
      method: "PATCH", body: JSON.stringify({ action: "session", tradingDate: "2026-08-19" }),
    }));
    expect(post.status).toBe(403);
    expect(patch.status).toBe(403);
  });
});
