import { describe, it, expect } from "vitest";
import { TtlCache } from "@/lib/market-data/cache";

describe("TtlCache", () => {
  it("returns a stored value before it expires", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("key", "value", 1000, 0);
    expect(cache.get("key", 500)).toBe("value");
  });

  it("returns null after the entry expires", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("key", "value", 1000, 0);
    expect(cache.get("key", 1001)).toBeNull();
  });

  it("returns null for a key that was never set", () => {
    const cache = new TtlCache<string>(1000);
    expect(cache.get("missing")).toBeNull();
  });

  it("uses the default TTL when none is provided", () => {
    const cache = new TtlCache<string>(500);
    cache.set("key", "value", undefined, 0);
    expect(cache.get("key", 400)).toBe("value");
    expect(cache.get("key", 600)).toBeNull();
  });

  it("clear() empties the cache", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("key", "value", 1000, 0);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("key", 0)).toBeNull();
  });
});
