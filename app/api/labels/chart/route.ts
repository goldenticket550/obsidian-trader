import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadArchiveLabelChart } from "@/lib/replay/archiveLabelChart";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const tradingDate = params.get("date") ?? "";
  const symbol = params.get("symbol") ?? "";
  const becameInteresting = params.get("becameInteresting") ?? "";
  try {
    return NextResponse.json({ chart: loadArchiveLabelChart({ tradingDate, symbol, becameInteresting }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message.startsWith("No archived") ? 404 : 400 });
  }
}
