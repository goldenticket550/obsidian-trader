import { DEFAULT_BAR_ADJUSTMENT, type CandlesMultiResult, type GetCandlesMultiParams, type MarketDataProvider } from "@/lib/market-data/types";
import { fetchedUniverse, type UniverseSymbol } from "./universePolicy";
import { ATTENTION_UNIVERSE } from "./universe";

export async function fetchConfiguredUniverse(
  provider: MarketDataProvider,
  universe: readonly UniverseSymbol[],
  request: Omit<GetCandlesMultiParams, "symbols" | "adjustment"> & { adjustment?: GetCandlesMultiParams["adjustment"] }
): Promise<CandlesMultiResult> {
  if (!provider.getCandlesMulti) throw new Error("Attention Engine requires the provider multi-symbol batch path.");
  const symbols = fetchedUniverse(universe).map((entry) => entry.symbol);
  const result = await provider.getCandlesMulti({ ...request, symbols, adjustment: request.adjustment ?? DEFAULT_BAR_ADJUSTMENT });
  for (const symbol of symbols) {
    if (!(symbol in result.candlesBySymbol)) throw new Error(`Batch provider omitted configured symbol ${symbol}.`);
  }
  return result;
}

export async function fetchAttentionUniverse(
  provider: MarketDataProvider,
  request: Omit<GetCandlesMultiParams, "symbols" | "adjustment"> & { adjustment?: GetCandlesMultiParams["adjustment"] }
): Promise<CandlesMultiResult> {
  return fetchConfiguredUniverse(provider, ATTENTION_UNIVERSE, request);
}
