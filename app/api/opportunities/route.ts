import { NextRequest, NextResponse } from "next/server";
import { getUserIdBySession } from "@/lib/auth";
import { getSessionToken } from "@/lib/request-context";
import { listOpportunities } from "@/services/opportunities/card";

export const dynamic = "force-dynamic";

/** Every trade idea the Telegram bot sent, newest first, open ones marked to the current price. */
export async function GET(request: NextRequest) {
  if (!(await getUserIdBySession(getSessionToken(request)))) {
    return NextResponse.json({ error: "Войдите на сайт" }, { status: 401 });
  }
  return NextResponse.json(await listOpportunities());
}
