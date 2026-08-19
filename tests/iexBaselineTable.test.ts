import { describe, expect, it } from "vitest";
import { assertIexBaselineTable, buildIexBaselineTable, evaluateStaticContinuousBaseline } from "@/lib/attention-runtime/iexBaselineTable";

describe("static IEX live baseline table", () => {
  it("is content-addressed and rejects a checkpoint-table identity mismatch", () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({ tradingDate: `2026-01-${String(index + 2).padStart(2, "0")}`, bars: {} }));
    const table = buildIexBaselineTable(sessions);
    expect(() => assertIexBaselineTable(table)).not.toThrow();
    expect(Object.keys(table.buckets)).toHaveLength(61 * 390);
    expect(() => assertIexBaselineTable({ ...table, tableId: "wrong" })).toThrow("identity mismatch");
  });

  it("evaluates a fitted lookup in O(1) without changing robust-z arithmetic", () => {
    const value = evaluateStaticContinuousBaseline({ state: "ok", sampleSize: 40, median: 2, mad: 1, transform: "linear", zClamp: 8 }, 3);
    expect(value).toBeCloseTo(1 / 1.4826, 12);
    expect(evaluateStaticContinuousBaseline({ state: "unavailable", sampleSize: 40, median: 0, mad: 0, transform: "linear", zClamp: 8 }, 3)).toBeNull();
  });
});
