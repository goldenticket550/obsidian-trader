import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const path = resolve("supabase/migrations/0012_attention_durable_checkpoints.sql");
const sql = readFileSync(path, "utf8");

describe("HOST-1 durable checkpoint migration", () => {
  it("keeps exactly three sequence boundaries per engine", () => {
    expect(sql).toContain("delete from attention_engine_checkpoints");
    expect(sql).toContain("order by sequence desc limit 3");
  });

  it("stores the complete event so API readers receive event.payload rather than an empty feed row", () => {
    expect(sql).toContain("to_timestamp((e->>'emittedAt')::double precision/1000),e)");
    expect(sql).not.toContain("to_timestamp((e->>'emittedAt')::double precision/1000),e->'payload')");
  });

  it("has one unique strictly ordered version per migration", () => {
    const files = readdirSync(resolve("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
    const versions = files.map((name) => name.slice(0, 4));
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual(["0001","0002","0003","0004","0005","0006","0007","0008","0009","0010","0011","0012"]);
  });
});
