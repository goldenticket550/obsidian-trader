import { PENDING_ARCHIVE, UNIVERSE as AUTHORED_UNIVERSE } from "@/docs/universe-authored";
import { assertAuthoredUniverseShape, type UniverseSymbol } from "./universePolicy";

/**
 * Runtime projection of the trader-authored Â§3.1 universe. The authored file
 * remains canonical; this boundary makes the optional source annotation
 * `referenceOnly` explicit for every runtime entry.
 */
export const ATTENTION_UNIVERSE: readonly UniverseSymbol[] = Object.freeze(
  AUTHORED_UNIVERSE.map((entry) => Object.freeze({
    ...entry,
    referenceOnly: entry.referenceOnly ?? false,
  }))
);

assertAuthoredUniverseShape(ATTENTION_UNIVERSE, 61, 7);

export const ATTENTION_UNIVERSE_BY_SYMBOL: ReadonlyMap<string, UniverseSymbol> = new Map(
  ATTENTION_UNIVERSE.map((entry) => [entry.symbol, entry])
);

export const PENDING_ARCHIVE_SYMBOLS: readonly string[] = PENDING_ARCHIVE;
