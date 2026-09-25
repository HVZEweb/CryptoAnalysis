import { NextResponse } from "next/server";
import { denyUnlessAdmin } from "@/lib/admin-auth";
import { marketDataStatus } from "@/services/market-data/collector";

export const dynamic = "force-dynamic";

/** How much market data the collector has accumulated so far. */
export async function GET(request: Request) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await marketDataStatus());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
