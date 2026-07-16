import { describe, it, expect } from "vitest";
import { RateLimiter } from "@/lib/market-data/rateLimiter";

describe("RateLimiter", () => {
  it("allows requests up to the limit", () => {
    const limiter = new RateLimiter(3, 60_000);
    const now = 1000;
    expect(limiter.canProceed(now)).toBe(true);
    limiter.recordRequest(now);
    expect(limiter.canProceed(now)).toBe(true);
    limiter.recordRequest(now);
    expect(limiter.canProceed(now)).toBe(true);
    limiter.recordRequest(now);
    expect(limiter.canProceed(now)).toBe(false);
  });

  it("frees up a slot once the window passes", () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.recordRequest(0);
    expect(limiter.canProceed(500)).toBe(false);
    expect(limiter.canProceed(1001)).toBe(true);
  });

  it("reports remaining requests accurately", () => {
    const limiter = new RateLimiter(5, 60_000);
    limiter.recordRequest(0);
    limiter.recordRequest(0);
    expect(limiter.remaining(0)).toBe(3);
  });

  it("reports zero wait time when under the limit", () => {
    const limiter = new RateLimiter(5, 60_000);
    expect(limiter.msUntilNextSlot(0)).toBe(0);
  });

  it("reports correct wait time when at the limit", () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.recordRequest(0);
    expect(limiter.msUntilNextSlot(400)).toBe(600);
  });
});
