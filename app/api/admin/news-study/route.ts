import { NextResponse } from "next/server";
import { denyUnlessAdmin } from "@/lib/admin-auth";
import { liveStudy } from "@/services/news-study/log";

export const dynamic = "force-dynamic";

/** How each type of news moved BTC, from the live news log. */
export async function GET(request: Request) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await liveStudy());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
