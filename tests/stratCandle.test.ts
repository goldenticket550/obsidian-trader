import { describe, it, expect } from "vitest";
import { classifyStratCandle, detectStratConfirmation } from "@/lib/indicators/stratCandle";
import { makeCandle } from "@/lib/fixtures/candles";

describe("classifyStratCandle", () => {
  it("classifies an inside bar as type 1", () => {
    const prior = makeCandle({ time: 0, high: 105, low: 100 });
    const candle = makeCandle({ time: 300, high: 104, low: 101 });
    expect(classifyStratCandle(candle, prior)).toBe("1");
  });

  it("classifies a directional-up bar as type 2u", () => {
    const prior = makeCandle({ time: 0, high: 105, low: 100 });
    const candle = makeCandle({ time: 300, high: 107, low: 101 });
    expect(classifyStratCandle(candle, prior)).toBe("2u");
  });

  it("classifies a directional-down bar as type 2d", () => {
    const prior = makeCandle({ time: 0, high: 105, low: 100 });
    const candle = makeCandle({ time: 300, high: 104, low: 98 });
    expect(classifyStratCandle(candle, prior)).toBe("2d");
  });

  it("classifies an outside bar as type 3", () => {
    const prior = makeCandle({ time: 0, high: 105, low: 100 });
    const candle = makeCandle({ time: 300, high: 108, low: 97 });
    expect(classifyStratCandle(candle, prior)).toBe("3");
  });
});

describe("detectStratConfirmation", () => {
  it("passes on a 2-2 reversal (2d followed by 2u)", () => {
    const candles = [
      makeCandle({ time: 0, high: 105, low: 100 }),
      makeCandle({ time: 300, high: 104, low: 97 }), // 2d vs prior
      makeCandle({ time: 600, high: 108, low: 98 }), // 2u vs prior (104/97)
    ];
    const result = detectStratConfirmation(candles);
    expect(result.passed).toBe(true);
    expect(result.pattern).toBe("2-2 reversal");
  });

  it("passes on an inside bar breaking higher (1-2u)", () => {
    const candles = [
      makeCandle({ time: 0, high: 105, low: 100 }),
      makeCandle({ time: 300, high: 104, low: 101 }), // inside bar (1)
      makeCandle({ time: 600, high: 107, low: 102 }), // breaks higher (2u)
    ];
    const result = detectStratConfirmation(candles);
    expect(result.passed).toBe(true);
    expect(result.pattern).toBe("1-2u break");
  });

  it("does not pass on an unrelated sequence", () => {
    const candles = [
      makeCandle({ time: 0, high: 105, low: 100 }),
      makeCandle({ time: 300, high: 108, low: 101 }), // 2u
      makeCandle({ time: 600, high: 110, low: 103 }), // 2u again, not a reversal pattern
    ];
    const result = detectStratConfirmation(candles);
    expect(result.passed).toBe(false);
  });

  it("returns not-passed with fewer than 3 candles", () => {
    const candles = [makeCandle({ time: 0 })];
    const result = detectStratConfirmation(candles);
    expect(result.passed).toBe(false);
  });
});
