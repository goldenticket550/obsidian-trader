import { describe, expect, it } from "vitest";
import { resolveAttentionAccess } from "@/lib/attention-runtime/access";

function client(rows: Record<string, unknown>) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        async maybeSingle() { return { data: rows[table] ?? null, error: null }; },
      };
      return chain;
    },
  };
}

describe("attention access resolution", () => {
  it("recognizes the engine owner without requiring a membership lookup", async () => {
    const supabase = client({ attention_engine_instances: { engine_instance_id: "engine", user_id: "owner" } });
    await expect(resolveAttentionAccess(supabase as never, "owner", "engine")).resolves.toEqual({
      engineInstanceId: "engine", role: "owner",
    });
    expect(supabase.calls).toEqual(["attention_engine_instances"]);
  });

  it("recognizes a viewer through an explicit membership", async () => {
    const supabase = client({
      attention_engine_instances: { engine_instance_id: "engine", user_id: "owner" },
      attention_engine_memberships: { role: "viewer" },
    });
    await expect(resolveAttentionAccess(supabase as never, "viewer", "engine")).resolves.toEqual({
      engineInstanceId: "engine", role: "viewer",
    });
    expect(supabase.calls).toEqual(["attention_engine_instances", "attention_engine_memberships"]);
  });

  it("refuses an authenticated non-member", async () => {
    const supabase = client({ attention_engine_instances: { engine_instance_id: "engine", user_id: "owner" } });
    await expect(resolveAttentionAccess(supabase as never, "stranger", "engine")).resolves.toBeNull();
  });
});
