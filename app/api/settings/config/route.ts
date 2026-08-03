import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStrategyConfig, upsertStrategyConfig } from "@/lib/watchlist/queries";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import {
  isConfigObject,
  normalizeReclaimContinuationConfig,
  validateReclaimContinuationConfig,
} from "@/lib/strategies/reclaimContinuationConfig";
import {
  normalizeExpansionUniverse,
  validateExpansionUniverse,
} from "@/lib/strategies/expansionUniverseConfig";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const config = await getStrategyConfig(supabase, user.id);
    return NextResponse.json({ config });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Malformed JSON is a CLIENT error. Parsing inside the main try block
  // would surface it as a 500 and blame the server for a bad request.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  // `unknown`, not a cast: JSON legitimately parses to null, a string, a
  // number or an array, and none of those is a configuration.
  if (!isConfigObject(body)) {
    return NextResponse.json(
      { error: "Request body must be a strategy configuration object" },
      { status: 400 }
    );
  }

  try {
    // Normalize the Reclaim block first, so an omitted key means "use the
    // default" rather than counting as a validation failure — but a value
    // that IS present and invalid is never silently repaired.
    const reclaimContinuation = normalizeReclaimContinuationConfig(
      body.reclaimContinuation as Partial<StrategyConfig["reclaimContinuation"]> | undefined
    );

    // Same rule for the expansion universe: an omitted field takes the
    // shipped list, a present-but-malformed one is rejected rather than
    // quietly repaired into a universe the caller never chose.
    const expansionUniverse = normalizeExpansionUniverse(
      body.expansionUniverse as StrategyConfig["expansionUniverse"] | undefined
    );

    const fieldErrors = [
      ...validateReclaimContinuationConfig(reclaimContinuation),
      ...validateExpansionUniverse(expansionUniverse),
    ];
    if (fieldErrors.length > 0) {
      return NextResponse.json(
        { error: "Invalid strategy configuration", fieldErrors },
        { status: 400 }
      );
    }

    // Persist the VALIDATED NORMALIZED configuration, not the unchecked
    // request body — otherwise a partial Reclaim block would be stored
    // short and fail on every later read. Unrelated strategy blocks are
    // carried through untouched.
    const toPersist = {
      ...defaultStrategyConfig,
      ...(body as Partial<StrategyConfig>),
      reclaimContinuation,
      expansionUniverse,
    } as StrategyConfig;

    await upsertStrategyConfig(supabase, user.id, toPersist);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
