import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getOrCreateDefaultWatchlist,
  getWatchlistSymbols,
  addWatchlistSymbol,
  removeWatchlistSymbol,
} from "@/lib/watchlist/queries";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const watchlistId = await getOrCreateDefaultWatchlist(supabase, user.id);
    const symbols = await getWatchlistSymbols(supabase, watchlistId);
    return NextResponse.json({ watchlistId, symbols });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const symbol = typeof body.symbol === "string" ? body.symbol : "";
    const exchange = typeof body.exchange === "string" ? body.exchange : "NASDAQ";
    if (!symbol.trim()) {
      return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    const watchlistId = await getOrCreateDefaultWatchlist(supabase, user.id);
    await addWatchlistSymbol(supabase, watchlistId, symbol, exchange);
    const symbols = await getWatchlistSymbols(supabase, watchlistId);
    return NextResponse.json({ symbols });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const symbol = typeof body.symbol === "string" ? body.symbol : "";
    if (!symbol.trim()) {
      return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    const watchlistId = await getOrCreateDefaultWatchlist(supabase, user.id);
    await removeWatchlistSymbol(supabase, watchlistId, symbol);
    const symbols = await getWatchlistSymbols(supabase, watchlistId);
    return NextResponse.json({ symbols });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
