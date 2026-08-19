import { describe, expect, it } from "vitest";
import { computeWeightedScore } from "@/lib/strategies/scorer";
import type { SetupCondition } from "@/types/setup";

const condition = (id: string, required: boolean, category: SetupCondition["category"], state: SetupCondition["state"]): SetupCondition =>
  ({ id, label: id, required, category, state });

const required = [
  condition("decline", true, "informational", "pass"),
  condition("recovery", true, "core", "pass"),
  condition("bullish", true, "supporting", "pass"),
  condition("sweep", true, "core", "pass"),
  condition("structure", true, "core", "pass"),
  condition("ema", true, "secondary", "pass"),
];
const optional = [
  condition("fvg", false, "secondary", "fail"), condition("gap", false, "informational", "fail"),
  condition("prior", false, "secondary", "fail"), condition("ladder", false, "supporting", "fail"),
  condition("benchmark", false, "secondary", "fail"), condition("volume", false, "supporting", "fail"),
  condition("daily", false, "secondary", "fail"),
];

describe("Setup Score required/core semantics", () => {
  it("a green-equivalent checklist cannot fall below the alert threshold", () => {
    expect(computeWeightedScore([...required, ...optional]).score).toBe(7);
  });

  it("a missing core condition cannot cross the alert threshold", () => {
    const everythingElsePasses: SetupCondition[] = [...required, ...optional].map((item) => ({ ...item, state: "pass" }));
    everythingElsePasses.find((item) => item.id === "structure")!.state = "fail";
    expect(computeWeightedScore(everythingElsePasses).score).toBeLessThan(7);
    expect(computeWeightedScore(everythingElsePasses).score).toBeLessThanOrEqual(6.5);
  });

  it("unavailable is excluded from arithmetic but still prevents required confirmation", () => {
    const items = [...required, ...optional];
    items[4] = { ...items[4], state: "unavailable", unavailableReason: "not enough candles" };
    expect(Number.isFinite(computeWeightedScore(items).score)).toBe(true);
    expect(computeWeightedScore(items).score).toBeLessThan(7);
  });
});
