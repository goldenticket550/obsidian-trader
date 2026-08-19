import { afterEach, describe, expect, it, vi } from "vitest";
import { AlpacaProvider } from "@/lib/market-data/providers/alpacaProvider";
import { MockProvider } from "@/lib/market-data/providers/mockProvider";

describe("getCandlesMulti", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses the multi-symbol endpoint, explicit feed/adjustment/window, and follows symbol-first pages", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1;
      return {
        ok: true, status: 200, statusText: "OK",
        json: async () => call === 1
          ? { feed: "sip", bars: { AAPL: [{ t: "2026-08-14T13:30:00Z", o: 1, h: 2, l: 1, c: 2, v: 10 }] }, next_page_token: "page2" }
          : { feed: "sip", bars: { NVDA: [{ t: "2026-08-14T13:30:00Z", o: 3, h: 4, l: 3, c: 4, v: 20 }] }, next_page_token: null },
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AlpacaProvider({ apiKeyId: "key", apiSecretKey: "secret", feed: "sip" });
    const result = await provider.getCandlesMulti!({
      symbols: ["AAPL", "NVDA"], timeframe: "1m",
      start: "2026-08-14T00:00:00Z", end: "2026-08-15T00:00:00Z", adjustment: "split",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(firstUrl.pathname).toBe("/v2/stocks/bars");
    expect(firstUrl.searchParams.get("symbols")).toBe("AAPL,NVDA");
    expect(firstUrl.searchParams.get("feed")).toBe("sip");
    expect(firstUrl.searchParams.get("adjustment")).toBe("split");
    expect(firstUrl.searchParams.get("end")).toBe("2026-08-15T00:00:00Z");
    expect(result.responseFeed).toBe("sip");
    expect(result.candlesBySymbol.AAPL).toHaveLength(1);
    expect(result.candlesBySymbol.NVDA).toHaveLength(1);
  });

  it("supports the same operation through the mock abstraction", async () => {
    const result = await new MockProvider().getCandlesMulti!({
      symbols: ["NVDA", "UNKNOWN"], timeframe: "5m",
      start: "2026-08-14T00:00:00Z", end: "2026-08-15T00:00:00Z", adjustment: "split",
    });
    expect(result.requestedFeed).toBe("mock");
    expect(Object.keys(result.candlesBySymbol)).toEqual(["NVDA", "UNKNOWN"]);
  });
});
