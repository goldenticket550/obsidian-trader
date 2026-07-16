import type { MarketDataProvider } from "./types";
import { MockProvider } from "./providers/mockProvider";
import { AlpacaProvider } from "./providers/alpacaProvider";

let cachedProvider: MarketDataProvider | null = null;

/**
 * Picks the active market-data provider based on server environment
 * variables. Server-only — this must never be imported into client
 * components, since it reads secret keys. Defaults to MockProvider when
 * no keys are configured, so the app never silently breaks; it just tells
 * you (via the "simulated" data quality) that it's not live.
 */
export function getMarketDataProvider(): MarketDataProvider {
  if (cachedProvider) return cachedProvider;

  const apiKeyId = process.env.ALPACA_API_KEY_ID;
  const apiSecretKey = process.env.ALPACA_API_SECRET_KEY;

  if (apiKeyId && apiSecretKey) {
    cachedProvider = new AlpacaProvider({
      apiKeyId,
      apiSecretKey,
      feed: (process.env.ALPACA_FEED as "iex" | "sip") ?? "iex",
      isPaidPlan: process.env.ALPACA_PAID_PLAN === "true",
    });
  } else {
    cachedProvider = new MockProvider();
  }

  return cachedProvider;
}

/** For tests — clears the cached singleton so each test starts fresh. */
export function resetProviderCache(): void {
  cachedProvider = null;
}
