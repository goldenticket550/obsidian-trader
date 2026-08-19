import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve("supabase/migrations/0011_attention_viewer_membership.sql"), "utf8");

describe("LIVE-2 membership migration", () => {
  it("is transactional and replaces every scanner SELECT policy", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    for (const policy of [
      "attention members read runtime health",
      "attention members read snapshots",
      "attention members read events",
      "attention members read own grant",
    ]) {
      expect(sql).toContain(`drop policy if exists \"${policy}\"`);
      expect(sql).toContain(`create policy \"${policy}\"`);
    }
  });

  it("keeps scanner writes service-only and makes every authenticated viewer read-only", () => {
    expect(sql).toContain("from authenticated;");
    expect(sql).toContain("grant all on public.attention_engine_memberships to service_role;");
    expect(sql).toContain("where schemaname = 'public'");
    expect(sql).toContain("as restrictive for insert to authenticated");
    expect(sql).toContain("as restrictive for update to authenticated");
    expect(sql).toContain("as restrictive for delete to authenticated");
    expect(sql).toContain("as restrictive for select to authenticated");
    expect(sql).toContain("not public.is_attention_read_only_viewer()");
  });
});
