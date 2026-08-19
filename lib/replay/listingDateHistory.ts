import { assertHistoricalSipWindow, assertSipResponseFeed, LIVE_BAR_ADJUSTMENT } from "./archive";
import { deriveEffectiveListingDate, type ListingDateDerivationOptions, type ListingDateResolution } from "./listingDates";
import type { MarketDataProvider } from "@/lib/market-data/types";

export const FULL_LISTING_HISTORY_START = "2000-01-01T00:00:00.000Z";

export async function acquireListingDateResolutions(
  provider: MarketDataProvider,
  authoredDates: Readonly<Record<string, string | null | undefined>>,
  end: string,
  options: ListingDateDerivationOptions = {}
): Promise<{ resolutions: ListingDateResolution[]; pagesFetched: number }> {
  const symbols = Object.keys(authoredDates).sort();
  if (symbols.length === 0) throw new Error("Listing-date acquisition requires at least one authored symbol/date.");
  if (!provider.getCandlesMulti) throw new Error("Listing-date acquisition requires getCandlesMulti.");
  assertHistoricalSipWindow(end, Date.now());
  const result = await provider.getCandlesMulti({
    symbols,
    timeframe: "1d",
    start: FULL_LISTING_HISTORY_START,
    end,
    adjustment: LIVE_BAR_ADJUSTMENT,
  });
  assertSipResponseFeed(result.requestedFeed, result.responseFeed);
  if (!result.pagination.complete || result.pagination.nextPageTokenRemaining) {
    throw new Error("Full daily listing history was truncated; refusing to derive listedSince.");
  }
  return {
    resolutions: symbols.map((symbol) => deriveEffectiveListingDate(symbol, result.candlesBySymbol[symbol] ?? [], authoredDates[symbol] ?? undefined, options)),
    pagesFetched: result.pagination.pagesFetched,
  };
}
