import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStrategyConfig, upsertStrategyConfig } from "@/lib/watchlist/queries";
import type { StrategyConfig } from "@/lib/strategies/config";

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

  try {
    const config = (await request.json()) as StrategyConfig;
    await upsertStrategyConfig(supabase, user.id, config);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
