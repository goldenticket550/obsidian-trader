import { defaultStrategyConfig, type StrategyConfig } from "./config";
import type { ConfigFieldError } from "./reclaimContinuationConfig";

/**
 * The EXPANSION UNIVERSE config block — normalization and validation.
 *
 * Same discipline as every other config block: a missing field takes the
 * shipped default, a field that is PRESENT but malformed is rejected at
 * the boundary rather than quietly repaired. A silently-fixed universe
 * would scan a list the user never chose, which is worse than an error.
 *
 * Nothing here decides how any calculation works — only which symbols
 * feed the expansion side.
 */

export type ExpansionUniverseEntry = StrategyConfig["expansionUniverse"][number];

/** Conservative ticker shape: uppercase alphanumerics, dot and hyphen. */
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.\-]{0,9}$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Fills in the default universe when the field is ABSENT.
 *
 * An empty array is preserved, never replaced: "I want no expansion
 * scanning" is a real choice and must not be silently overridden by the
 * default list. Only `undefined`/`null` means "never configured".
 *
 * A present-but-malformed value is returned UNCHANGED so validation can
 * see it and report it — normalization never launders bad input.
 */
export function normalizeExpansionUniverse(
  value: StrategyConfig["expansionUniverse"] | undefined | null
): StrategyConfig["expansionUniverse"] {
  if (value === undefined || value === null) {
    // A copy, so a caller mutating its config cannot mutate the shipped
    // default for every later reader in the process.
    return defaultStrategyConfig.expansionUniverse.map((entry) => ({ ...entry }));
  }
  return value;
}

/**
 * Returns EVERY problem, not just the first, so the settings UI can show
 * a complete list instead of one error per save attempt.
 */
export function validateExpansionUniverse(
  value: StrategyConfig["expansionUniverse"] | undefined | null
): ConfigFieldError[] {
  const errors: ConfigFieldError[] = [];
  const at = (field: string, message: string) => errors.push({ field, message });

  if (!Array.isArray(value)) {
    at("expansionUniverse", "must be an array of { symbol, exchange } entries");
    return errors;
  }

  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const where = `expansionUniverse[${index}]`;

    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      at(where, "must be an object with symbol and exchange");
      return;
    }

    const { symbol, exchange } = entry as Record<string, unknown>;

    if (!isNonEmptyString(symbol)) {
      at(`${where}.symbol`, "must be a non-empty string");
    } else if (!SYMBOL_PATTERN.test(symbol)) {
      at(
        `${where}.symbol`,
        "must be 1-10 uppercase letters, digits, dots or hyphens"
      );
    } else if (seen.has(symbol)) {
      // A duplicate would scan and render the same symbol twice.
      at(`${where}.symbol`, `duplicates an earlier entry (${symbol})`);
    } else {
      seen.add(symbol);
    }

    if (!isNonEmptyString(exchange)) {
      at(`${where}.exchange`, "must be a non-empty string");
    }
  });

  return errors;
}
